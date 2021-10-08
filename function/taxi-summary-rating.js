const Bucket = require("@spica-devkit/bucket");

const SECRET_API_KEY = process.env.SECRET_API_KEY;
const TAXI_RATING_BUCKET = process.env.TAXI_RATING_BUCKET;

export async function summaryRating(req, res) {
    Bucket.initialize({ apikey: SECRET_API_KEY });
  
    let ratingsData = await Bucket.data.getAll(TAXI_RATING_BUCKET, {queryParams: {
        rating_to: req.query.id
    }});
    
    var ratings = [];
    var ratSum = 0;
    for (let i in ratingsData) {
        ratings[i] = ratingsData[i].rating;
        ratSum += ratingsData[i].rating;
    }

    var summary = ratings.reduce(
        (b, c) => (
            (
                b[b.findIndex(d => d.rounded_rating === c)] ||
                b[b.push({ total: 0, rounded_rating: c }) - 1]
            ).total++,
            b
        ),
        []
    );

    var average_rating = ratSum / ratings.length;

    res.status(200).send({
        average_rating: average_rating,
        summary: summary,
        total_ratings: ratings.length
    });
}
