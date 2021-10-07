const Bucket = require("@spica-devkit/bucket");
import * as jsonpatch from "fast-json-patch/index.mjs";
const fetch = require("node-fetch");

const SECRET_API_KEY = process.env.SECRET_API_KEY;
const GOOGLE_MAP_API_KEY = process.env.GOOGLE_MAP_API_KEY
const TAXI_RIDE_BUCKET = process.env.TAXI_RIDE_BUCKET
const TAXI_COUPON_BUCKET = process.env.TAXI_COUPON_BUCKET
const TAXI_COUPON_USER_BUCKET = process.env.TAXI_COUPON_USER_BUCKET

const STRIPE_PAYMENT_METHOD_ID = process.env.STRIPE_PAYMENT_METHOD_ID;
const STRIPE_PAYMENT_BUCKET = process.env.STRIPE_PAYMENT_BUCKET;
const STRIPE_CUSTOMER_BUCKET = process.env.STRIPE_CUSTOMER_BUCKET;
const STRIPE_CARD_BUCKET = process.env.STRIPE_CARD_BUCKET;

export async function rideAccept(action) {
    Bucket.initialize({ apikey: SECRET_API_KEY });

    const data_pre = action.previous;
    const data_curr = action.current;

    const patch = compare(data_pre, data_curr);

    for (let i in patch) {
        if (patch[i].path == "/status" && patch[i].value == "accepted") {
            let rideData = await Bucket.data
                .getAll(TAXI_RIDE_BUCKET, {
                    queryParams: {
                        filter: {
                            _id: data_pre.ride
                        }
                    }
                })
                .then(data => data[0]);

            rideData.status = "accepted";
            rideData.driver = data_pre.driver;
            rideData.ride_start_at = new Date();

            await Bucket.data.update(
                TAXI_RIDE_BUCKET,
                data_pre.ride,
                rideData
            );
        }
    }
}

export async function rideUpdate(action) {
    Bucket.initialize({ apikey: SECRET_API_KEY });

    const data_pre = action.previous;
    const data_curr = action.current;

    const patch = compare(data_pre, data_curr);

    for (let i in patch) {
        if (patch[i].path == "/status" && patch[i].value == "pending_accept") {
            let rideData = (await Bucket.data.getAll(TAXI_RIDE_BUCKET, {
                queryParams: {
                    filter: {
                        _id: data_pre._id
                    }
                }
            }))[0];

            if (rideData.coupon_code) {
                var finalAmount = data_pre.estimated_fare;
                var discount = await calculateDiscount(
                    rideData.coupon_code,
                    finalAmount,
                    true,
                    rideData.user
                );
                finalAmount -= discount;
                rideData.discount = discount;
                rideData.estimated_fare = finalAmount;
            }

            await Bucket.data
                .update(TAXI_RIDE_BUCKET, rideData._id, rideData)
                .catch(err => console.log("Update Ride Error: ", err));
        }
        if (patch[i].path == "/status" && patch[i].value == "complete") {
            let rideDataRelation = await Bucket.data
                .getAll(TAXI_RIDE_BUCKET, {
                    queryParams: {
                        filter: {
                            _id: data_pre._id
                        },
                        relation: true
                    }
                })
                .then(data => data[0]);

            let rideData = (await Bucket.data.getAll(TAXI_RIDE_BUCKET, {
                queryParams: {
                    filter: {
                        _id: data_pre._id
                    }
                }
            }))[0];

            var distanceAndTime = await getDistanceAndTime(
                rideData.latitude_from,
                rideData.longitude_from,
                rideDataRelation.driver.current_latitude,
                rideDataRelation.driver.current_longitude
            );

            rideData.final_fare = rideData.estimated_fare;
            rideData.final_distance = distanceAndTime[0];
            rideData.final_time = (new Date() - new Date(rideData.ride_start_at)) / 60000;
            rideData.ride_ends_at = new Date();

            const newRideData = await Bucket.data
                .update(TAXI_RIDE_BUCKET, data_pre._id, rideData)
                .catch(err => console.log("New Ride Data: ", err));

            if (newRideData.payment_method == STRIPE_PAYMENT_METHOD_ID) {
                const customer = (await Bucket.data.getAll(STRIPE_CUSTOMER_BUCKET, {
                    queryParams: {
                        filter: {
                            name: newRideData.user
                        }
                    }
                }))[0];

                const card = (await Bucket.data.getAll(STRIPE_CARD_BUCKET, {
                    queryParams: {
                        filter: {
                            customer: customer._id
                        }
                    }
                }))[0];

                let paymnetData = {
                    customer: customer._id,
                    card: card._id,
                    payment_type: "charge",
                    currency: "usd",
                    price: newRideData.final_fare
                };

                await Bucket.data
                    .insert(STRIPE_PAYMENT_BUCKET, paymnetData)
                    .catch(err => console.log("Payment Insert ERROR: ", err));
            }
        }
    }
}

function compare(data_pre, data_curr) {
    const patch = jsonpatch.compare(data_pre, data_curr);
    return patch;
}

async function getDistanceAndTime(fromLat, fromLong, toLat, toLong) {
    var distance = 0;
    var time = 0;
    console.log(fromLat, fromLong, toLat, toLong);
    var url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${fromLat},${fromLong}&destinations=${toLat},${toLong}&key=${GOOGLE_MAP_API_KEY}`;

    await fetch(url, {
        method: "GET"
    })
        .then(res => res.json())
        .then(json => {
            distance = json.rows[0].elements[0].distance.value / 1000;
            time = json.rows[0].elements[0].duration.value / 60;
            console.log("DISTANCE", json.rows[0].elements[0])
        })
        .catch(err => console.log("err", err));

    return [distance, time];
}

async function calculateDiscount(code, amount, countUsage = false, user) {
    var discount = 0;
    Bucket.initialize({ apikey: SECRET_API_KEY });

    if (code) {
        var coupon = await Bucket.data
            .getAll(TAXI_COUPON_BUCKET, {
                queryParams: {
                    filter: {
                        code: code
                    }
                }
            })
            .then(data => data[0]);

        // var checkCoupon = await checkCouponValidity()

        if (coupon.type == "fixed") {
            discount = coupon.reward;
        }

        if (coupon.type == "percent") {
            discount = (amount * coupon.reward) / 100;
        }

        if (countUsage) {
            await Bucket.data
                .insert(TAXI_COUPON_USER_BUCKET, {
                    user: user._id,
                    coupon: coupon._id,
                    user_coupon: `${user.name} -> ${coupon.data}`
                })
                .then(res => console.log("RES", res))
                .catch(err => console.log(err));
        }
    }

    return discount;
}

async function checkCouponValidity(coupon_id, user_id) {
    var isUsed = await Bucket.data
        .getAll(TAXI_COUPON_USER_BUCKET, {
            queryParams: {
                filter: {
                    user: user_id,
                    coupon: coupon_id
                }
            }
        })
        .then(data => data[0]);

    if (isUsed) return "Code already used";

    var isExpired = await Bucket.data
        .getAll(TAXI_COUPON_BUCKET, {
            queryParams: {
                filter: {
                    _id: coupon_id,
                    expires_at: { $lt: `Date(${new Date()})` }
                }
            }
        })
        .then(data => data[0]);

    if (isExpired) return "Code expired";

    return true;
}
