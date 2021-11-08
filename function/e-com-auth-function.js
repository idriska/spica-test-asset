import * as Bucket from "@spica-devkit/bucket";
import * as Identity from "@spica-devkit/identity";
import { database, ObjectId } from "@spica-devkit/database";

const SECRET_API_KEY = process.env.SECRET_API_KEY;
const ECOM_USER_BUCKET = process.env.ECOM_USER_BUCKET
const ECOM_PUBLIC_POLICY = process.env.ECOM_PUBLIC_POLICY

// ------- Insert your APIKEY, mailerBucketId and usersBucketId.
Bucket.initialize({ apikey: SECRET_API_KEY });
Identity.initialize({ apikey: SECRET_API_KEY });

export async function register(req, res) {
    // ------- CUSTOMIZED
    let { user_data } = req.body;
    console.log("registiration start with this parameter : ", user_data);

    if (user_data.email && user_data.password) {
        let identity = await Identity.insert({
            identifier: user_data.email,
            password: user_data.password,
            policies: []
        }).catch(err => {
            console.log(err);
            return err;
        });

        if (identity._id) {
            let user = await Bucket.data.insert(ECOM_USER_BUCKET, {
                ...user_data,
                identity_id: identity._id,
               
            });
            const db = await database();
            const identityCollection = db.collection("identity");
            const _identity = await identityCollection.findOne({
                _id: ObjectId(identity._id)
            });

            _identity.policies = [ECOM_PUBLIC_POLICY];
            await identityCollection.update({ _id: ObjectId(identity._id) }, { $set: _identity });

            return res.status(200).send({ message: "Registration successful", data: user._id });
        } else {
            return res.status(400).send({ message: identity.message });
        }
    }
    return res.status(400).send({ message: "Invalid email or password provided" });
}