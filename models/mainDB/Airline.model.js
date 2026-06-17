// models/Airline.js
import { Schema } from 'mongoose';
import { mainConnection  } from "../../db/connectMongoDB.js"; // Import your specific connection


const airlineSchema = new Schema({
    airLineCode: String,
    airLineName: String,
    airlineNameAr: String
});
const Airline = mainConnection.model('Airline', airlineSchema)

export default Airline;
