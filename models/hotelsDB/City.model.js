import { Schema } from 'mongoose';
import { hotelsConnection } from "../../db/connectMongoDB.js"; // Import your specific connection

const citySchema = new Schema({
    id: String,
    countryCode: String,
    flag: String,
    cities: [
        {
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
        }
    ]
});


const City = hotelsConnection.model("City", citySchema);
export default City;