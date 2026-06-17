import { Schema } from 'mongoose';
import { hotelsConnection } from "../../db/connectMongoDB.js"; // Import your specific connection

const countrySchema = new Schema({
    Code: {
        type: String,
        required: true
    },
    Name: {
        type: String,
        required: true
    },
    NameAr: {
        type: String,
        required: true
    }
});


const Country = hotelsConnection.model("Country", countrySchema);
export default Country;