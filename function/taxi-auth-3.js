const Bucket = require("@spica-devkit/bucket");
const jwt_decode = require("jwt-decode");
const jwt = require("jsonwebtoken");
const request = require("request");
const { promisify } = require("util");
const rp = promisify(request);
import fetch from 'node-fetch';

const PUBLIC_URL = process.env.__INTERNAL__SPICA__PUBLIC_URL__
const SECRET_API_KEY = process.env.SECRET_API_KEY;
const TAXI_USER_BUCKET = process.env.TAXI_USER_BUCKET
const TAXI_PUBLIC_POLICY = process.env.TAXI_PUBLIC_POLICY
const TAXI_DRIVER_BUCKET = process.env.TAXI_DRIVER_BUCKET

export async function register(request, response) {
    let user_data = request.body.user_data
    Bucket.initialize({ apikey: SECRET_API_KEY });
    var identity_id;

    await fetch(`${PUBLIC_URL}/passport/identity`, {
        method: "post",
        body: JSON.stringify({
            attributes: {},
            identifier: user_data.mobile_number,
            password: SECRET_API_KEY,
            policies: []
        }),
        headers: { "Content-Type": "application/json", Authorization: `APIKEY ${SECRET_API_KEY}` }
    })
        .then(res => res.json())
        .then(json => {
            identity_id = json._id;
        })
        .catch(err => console.log("err", err));

    const userData = await Bucket.data.insert(TAXI_USER_BUCKET, {
        identity_id: identity_id,
        mobile_number: user_data.mobile_number,
        email: user_data.email,
        name: user_data.name,
        iamge: user_data.image,
        role: user_data.role
    });

    await fetch(
        `${PUBLIC_URL}/passport/identity/${identity_id}/policy/${TAXI_PUBLIC_POLICY}`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `APIKEY ${SECRET_API_KEY}` }
        }
    );

    if (user_data.role == "driver") {
        await Bucket.data.insert(TAXI_DRIVER_BUCKET, {
            user: userData._id
        });
    }

    response.status(200).send({
        message: "OK"
    });
}

export async function login(request, response) {
    let token;
    Bucket.initialize({ apikey: SECRET_API_KEY });

    const verify = await firebaseTokenVerify(request.body.fb_token);
    const verifyNumber = verify.phone_number.split("+");
    if (verifyNumber[1] == request.body.mobile_number) {
        await fetch(
            `${PUBLIC_URL}/passport/identify?password=${SECRET_API_KEY}&identifier=${request.body.mobile_number}`,
            {
                method: "GET",
                headers: { "Content-Type": "application/json" }
            }
        )
            .then(res => res.json())
            .then(json => {
                token = json.token;
            })
            .catch(err => console.log("err", err));

        if (token) {
            var decoded = await jwt_decode(token);
            
            let userData = await Bucket.data
                .getAll(TAXI_USER_BUCKET, {
                    queryParams: {
                        filter: { identity_id: decoded._id }
                    }
                })
                .then(data => data[0]);

            response.status(200).send({
                token: token,
                user: userData
            });
        } else {
            response.status(404).send({ message: "User not found" });
        }
    } else {
        response.status(200).send(verify);
    }
}

export async function checkUser(request, response) {
    Bucket.initialize({ apikey: SECRET_API_KEY });

    let user = await Bucket.data
        .getAll(TAXI_USER_BUCKET, {
            queryParams: {
                filter: {
                    mobile_number: request.query.mobile_number,
                    role: request.query.role
                }
            }
        })
        .then(data => data[0]);

    if (user) {
        response.status(200).send({
            message: "User exists"
        });
    } else {
        response.status(404).send({
            message: "User not found"
        });
    }
}

async function firebaseTokenVerify(token) {
    const response = await rp(
        "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
    );
    const publicKeys = JSON.parse(response.body);

    try {
        const header64 = token.split(".")[0];
        const header = JSON.parse(Buffer.from(header64, "base64").toString("ascii"));

        return jwt.verify(token, publicKeys[header.kid], { algorithms: ["RS256"] });
    } catch (error) {
        console.log("error jwt: ", error);
    }
}
