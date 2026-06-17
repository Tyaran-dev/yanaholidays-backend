import pg from 'pg';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbConfig = {
    host: 'localhost',
    database: 'hotels_db',
    user: 'hotels_user',
    password: 'KOKOa@2020',
    port: 5432
};

async function importHotelsStream() {
    const client = new Client(dbConfig);

    try {
        console.log('Connecting to database...');
        await client.connect();

        // Disable trigger for performance
        // console.log('Disabling trigger...');
        // await client.query('ALTER TABLE hotels DISABLE TRIGGER hotels_name_search_trigger');

        const filePath = join(__dirname, '..', '..', 'hotels_all.js');
        console.log(`Processing file: ${filePath}`);

        // Create read stream
        const fileStream = fs.createReadStream(filePath, {
            encoding: 'utf8',
            highWaterMark: 64 * 1024
        });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let hotelsBuffer = [];
        let lineCount = 0;
        let batchSize = 5000;
        let totalImported = 0;
        const seenHotelIds = new Set(); // Track seen hotel_ids

        console.log('Starting stream processing...');

        for await (const line of rl) {
            lineCount++;

            // Skip export line and empty lines
            if (line.includes('export const hotels =') ||
                line.includes('module.exports =') ||
                line.trim() === '' ||
                line.trim() === '[' ||
                line.trim() === ']') {
                continue;
            }

            // Remove trailing comma from JSON lines
            let jsonLine = line.trim();
            if (jsonLine.endsWith(',')) {
                jsonLine = jsonLine.slice(0, -1);
            }

            try {
                const hotel = JSON.parse(jsonLine);
                
                // Generate hotel_id
                const hotelId = hotel.hotel_code || `hotel_${lineCount}`;
                
                // Skip if we've already seen this hotel_id in this session
                if (seenHotelIds.has(hotelId)) {
                    console.log(`Skipping duplicate hotel_id: ${hotelId} at line ${lineCount}`);
                    continue;
                }
                
                seenHotelIds.add(hotelId);
                hotelsBuffer.push({ ...hotel, _hotel_id: hotelId });

                // Process batch when buffer is full
                if (hotelsBuffer.length >= batchSize) {
                    await processBatch(client, hotelsBuffer);
                    totalImported += hotelsBuffer.length;
                    hotelsBuffer = [];
                    
                    // Optional: Clear seenHotelIds periodically if memory is an issue
                    // seenHotelIds.clear();

                    console.log(`Processed ${lineCount} lines, imported ${totalImported} hotels`);
                }
            } catch (error) {
                console.error(`Error parsing line ${lineCount}:`, error.message);
                console.log(`Problematic line preview: ${jsonLine.substring(0, 200)}...`);
            }
        }

        // Process remaining hotels
        if (hotelsBuffer.length > 0) {
            await processBatch(client, hotelsBuffer);
            totalImported += hotelsBuffer.length;
        }

        console.log(`\nTotal lines processed: ${lineCount}`);
        console.log(`Total hotels imported: ${totalImported}`);
        console.log(`Duplicates skipped: ${lineCount - totalImported}`);

        // Update name_search
        // console.log('\nUpdating name_search column...');
        // await client.query(`
        //     UPDATE hotels 
        //     SET name_search = to_tsvector('simple', COALESCE(name, ''))
        //     WHERE name_search IS NULL OR name_search = ''
        // `);

        // Re-enable trigger
        // await client.query('ALTER TABLE hotels ENABLE TRIGGER hotels_name_search_trigger');

        console.log('✅ Import completed!');

    } catch (error) {
        console.error('❌ Import failed:', error.message);
        process.exit(1);
    } finally {
        await client.end();
        console.log('Database connection closed');
    }
}

async function processBatch(client, hotels) {
    if (hotels.length === 0) return;

    const values = [];
    const placeholders = [];
    
    // Remove duplicates within the batch itself
    const uniqueHotels = [];
    const batchHotelIds = new Set();
    
    for (const hotel of hotels) {
        const hotelId = hotel._hotel_id || hotel.hotel_code || '';
        if (!batchHotelIds.has(hotelId)) {
            batchHotelIds.add(hotelId);
            uniqueHotels.push(hotel);
        } else {
            console.log(`Duplicate within batch: ${hotelId}`);
        }
    }
    
    console.log(`Processing ${uniqueHotels.length} unique hotels from ${hotels.length} total`);

    uniqueHotels.forEach((hotel, index) => {
        const base = index * 9;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`);

        const hotelId = hotel._hotel_id || hotel.hotel_code || '';
        
        values.push(
            hotelId,                            // hotel_id
            hotel.hotel_code || '',             // hotel_code
            hotel.name || '',
            hotel.address || null,
            hotel.city_code || '',
            hotel.city_name || '',
            hotel.country_name || '',
            hotel.star_rating || null,
            Array.isArray(hotel.image_urls) ? hotel.image_urls : []
        );
    });

    const query = `
        INSERT INTO hotels (
            hotel_id, hotel_code, name, address, city_code, city_name, 
            country_name, star_rating, image_urls
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (hotel_id) DO UPDATE SET
            hotel_code = EXCLUDED.hotel_code,
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            city_code = EXCLUDED.city_code,
            city_name = EXCLUDED.city_name,
            country_name = EXCLUDED.country_name,
            star_rating = EXCLUDED.star_rating,
            image_urls = EXCLUDED.image_urls
    `;

    try {
        await client.query(query, values);
    } catch (error) {
        console.error('Batch insert error:', error.message);
        // Log a sample of the problematic data
        if (uniqueHotels.length > 0) {
            console.log('Sample hotel from failed batch:', {
                hotel_id: uniqueHotels[0]._hotel_id,
                hotel_code: uniqueHotels[0].hotel_code,
                name: uniqueHotels[0].name?.substring(0, 50)
            });
        }
        throw error;
    }
}

await importHotelsStream();