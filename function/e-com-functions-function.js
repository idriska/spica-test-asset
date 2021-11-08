import * as Bucket from "@spica-devkit/bucket";
import * as Identity from "@spica-devkit/identity";

const APIKEY = process.env.ECOMMERCE_APIKEY;

// Buckets
const PRODUCT_BUCKET = process.env.PRODUCT_BUCKET;
const STOCK_BUCKET = process.env.STOCK_BUCKET;
const BASKET_BUCKET = process.env.BASKET_BUCKET;
const COUPON_BUCKET = process.env.COUPON_BUCKET;
const USED_COUPON_BUCKET = process.env.USED_COUPON_BUCKET;

Bucket.initialize({ apikey: APIKEY });

export async function orderInserted(change) {
    const target = change.current;
    const basketId = target.basket;

    if (!basketId) {
        return;
    }

    const basketData = await Bucket.data.get(BASKET_BUCKET, basketId).catch(err => console.log("ERROR ", err))

    updateStockQuantity(basketData);
    updateBasketStatus(basketId);
    updateUsedCoupon(basketData);

    return true;
}

export async function updateBasketPrice(change) {
    const target = change.current;

    const productIds = target.product;
    let totalPrice = 0;
    const now = new Date();

    if (!productIds.length) {
        return;
    }

    const products = await Bucket.data.getAll(PRODUCT_BUCKET, {
        queryParams: { filter: { _id: { $in: productIds } } },
    }).catch(err => console.log("ERROR ", err))


    for (const product of products) {
        if (product.discounted_price) {
            totalPrice += product.discounted_price;
        } else {
            totalPrice += product.normal_price;
        }
    }

    return Bucket.data.patch(BASKET_BUCKET, target._id, { total_price: totalPrice }).catch(err => console.log("ERROR", err))
}

async function updateStockQuantity(basketData) {
    const products = basketData.product;
    const promises = [];

    const stocks = await Bucket.data.getAll(STOCK_BUCKET, {
        queryParams: { filter: { product: { $in: products } } },
    }).catch(err => console.log("ERROR ", err))

    for (const stock of stocks) {
        if (stock.is_enable) {
            let newQuantity = Math.max(stock.quantity - 1, 0)
            promises.push(
                Bucket.data.patch(STOCK_BUCKET, stock._id, { quantity: newQuantity })
            );
        }
    }

    return Promise.all(promises);
}

function updateBasketStatus(basketId) {
    return Bucket.data.patch(BASKET_BUCKET, basketId, { is_completed: true })
}

function updateUsedCoupon(basketData) {
    if (!basketData.user || !basketData.coupon) {
        return
    }

    let insertedData = {
        title: "Coupon Used",
        coupon: basketData.coupon,
        user: basketData.user,
        date: new Date()
    }

    return Bucket.data.insert(USED_COUPON_BUCKET, insertedData).catch(err => console.log("ERROR ", err))

}

export async function validateCoupone(req, res) {
    let token = getToken(req.headers.get("authorization"));
    let token_object = await tokenVerified(token);

    if (token_object.error) {
        return res.status(400).send({ message: "Token is not verified." });
    }

    const { couponCode, userId } = req.body;

    const coupon = await Bucket.data.getAll(COUPON_BUCKET, {
        queryParams: {
            filter: {
                code: couponCode,
                expiry_date: { "$gte": `Date(${new Date()})` }
            }
        }
    }).catch(err => console.log("ERROR ", err))

    if (!coupon[0]) {
        return res.status(200).send({ message: "Coupon is invalid" });
    }

    const usedCoupon = await Bucket.data.getAll(USED_COUPON_BUCKET, {
        queryParams: {
            filter: {
                coupon: coupon._id,
                user: userId
            }
        }
    }).catch(err => console.log("ERROR ", err))

    if (usedCoupon[0]) {
        return res.status(200).send({ message: "Cupon used before" });
    }

    return res.status(200).send({ message: "Coupon is valid" });
}

// -----HELPER FUNCTION-----
function getToken(token) {
    if (token) {
        token = token.split(" ")[1];
    } else {
        token = "";
    }

    return token;
}

async function tokenVerified(token) {
    let response_object = {
        error: false
    };

    Identity.initialize({ apikey: `${APIKEY}` });
    const decoded = await Identity.verifyToken(token).catch(err => (response_object.error = true));
    response_object.decoded_token = decoded;

    return response_object;
}
