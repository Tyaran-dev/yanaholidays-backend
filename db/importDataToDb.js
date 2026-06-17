import dotenv from 'dotenv';
import {connectAllDatabases} from "./connectMongoDB.js";
import Airport from "../models/mainDB/airport.model.js";
import Airline from '../models/mainDB/Airline.model.js';
import {airports} from "../data/fc-airports.js";
import {airlines} from "../data/airlines.js"

// Load environment variables FIRST
dotenv.config();

const seedData = async () => {
    try {
        console.log('Starting  data seeding...');

        await connectAllDatabases();
        console.log('✅ Connected to  database');

        await Airline.deleteMany({});
        console.log('🗑️  Cleared existing  data');

        const result = await Airline.insertMany(airlines)
        console.log(`✅ ${result.length} data inserted successfully`);

        console.log('\n✅ data seeding completed!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error seeding cities data:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Run the seed function
seedData();