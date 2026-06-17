const { Client } = require('pg');
const fs = require('fs');

// Database configuration
const dbConfig = {
    host: 'localhost',
    database: 'hotels_db',
    user: 'your_username',  // Change this!
    password: 'your_password',  // Change this!
    port: 5432,
    // Increase timeouts for large import
    connectionTimeoutMillis: 60000,
    idleTimeoutMillis: 60000,
    // Enable keep-alive
    keepAlive: true
};

async function importHotels() {
    const client = new Client(dbConfig);
    
    try {
        console.log('Connecting to database...');
        await client.connect();
        
        // Step 1: Read and parse the JS file
        console.log('Reading hotels.js file...');
        let jsContent;
        try {
            jsContent = fs.readFileSync('hotels.js', 'utf8');
        } catch (error) {
            console.error('Error reading file:', error.message);
            console.log('Trying with different encodings...');
            // Try different encodings
            jsContent = fs.readFileSync('hotels.js', 'utf16le');
        }
        
        // Remove export statement and parse JSON
        let jsonStr = jsContent;
        if (jsContent.includes('export const hotels =')) {
            jsonStr = jsContent.replace('export const hotels =', '').trim();
        }
        // Also handle module.exports format
        if (jsContent.includes('module.exports =')) {
            jsonStr = jsContent.replace('module.exports =', '').trim();
        }
        
        // Clean up trailing semicolon
        jsonStr = jsonStr.replace(/;\s*$/, '');
        
        let hotels;
        try {
            hotels = JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('JSON parse error:', parseError.message);
            // Try to fix common JSON issues
            jsonStr = jsonStr.replace(/'/g, '"');
            hotels = JSON.parse(jsonStr);
        }
        
        console.log(`Found ${hotels.length} hotels to import`);
        
        // Step 2: Disable trigger for performance
        console.log('Disabling trigger for faster import...');
        await client.query('ALTER TABLE hotels DISABLE TRIGGER hotels_name_search_trigger');
        
        // Step 3: Create temporary index on hotel_code for faster upserts
        console.log('Creating temporary index...');
        await client.query('CREATE INDEX IF NOT EXISTS temp_hotel_code_idx ON hotels(hotel_code)');
        
        // Step 4: Prepare the insert query
        const insertQuery = `
            INSERT INTO hotels (
                hotel_code, name, address, city_code, city_name, 
                country_name, star_rating, image_urls
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (hotel_code) DO UPDATE SET
                name = EXCLUDED.name,
                address = EXCLUDED.address,
                city_code = EXCLUDED.city_code,
                city_name = EXCLUDED.city_name,
                country_name = EXCLUDED.country_name,
                star_rating = EXCLUDED.star_rating,
                image_urls = EXCLUDED.image_urls
        `;
        
        // Step 5: Import in batches
        const batchSize = 5000; // Adjust based on your system memory
        let imported = 0;
        let failed = 0;
        const failedHotels = [];
        
        console.log('Starting batch import...');
        console.time('Total import time');
        
        for (let i = 0; i < hotels.length; i += batchSize) {
            const batch = hotels.slice(i, i + batchSize);
            
            // Use transaction for each batch
            await client.query('BEGIN');
            
            try {
                for (const hotel of batch) {
                    try {
                        await client.query(insertQuery, [
                            hotel.hotel_code || '',
                            hotel.name || '',
                            hotel.address || null,
                            hotel.city_code || '',
                            hotel.city_name || '',
                            hotel.country_name || '',
                            hotel.star_rating || null,
                            hotel.image_urls || []
                        ]);
                        imported++;
                    } catch (hotelError) {
                        failed++;
                        failedHotels.push({
                            hotel_code: hotel.hotel_code,
                            error: hotelError.message
                        });
                        console.error(`Failed to import ${hotel.hotel_code}:`, hotelError.message);
                    }
                }
                
                await client.query('COMMIT');
                
                // Log progress every 100k records
                if (imported % 100000 === 0) {
                    console.log(`Progress: ${imported} hotels imported, ${failed} failed`);
                    console.log(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
                }
                
                // Show progress every batch
                console.log(`Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(hotels.length/batchSize)}: ${i + batch.length} of ${hotels.length}`);
                
            } catch (batchError) {
                await client.query('ROLLBACK');
                console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, batchError.message);
                failed += batch.length;
            }
            
            // Clear memory periodically
            if (i % (batchSize * 10) === 0) {
                if (global.gc) {
                    global.gc();
                }
            }
        }
        
        console.timeEnd('Total import time');
        
        // Step 6: Update name_search for all rows
        console.log('Updating name_search column...');
        console.time('name_search update');
        
        await client.query(`
            UPDATE hotels 
            SET name_search = to_tsvector('simple', COALESCE(name, ''))
            WHERE name_search IS NULL OR name_search = ''
        `);
        
        console.timeEnd('name_search update');
        
        // Step 7: Create GIN index for faster searches
        console.log('Creating GIN index for name_search...');
        console.time('Index creation');
        
        try {
            await client.query('DROP INDEX IF EXISTS hotels_name_search_gin_idx');
        } catch (e) {
            // Ignore if index doesn't exist
        }
        
        await client.query(`
            CREATE INDEX CONCURRENTLY hotels_name_search_gin_idx 
            ON hotels USING GIN (name_search)
        `);
        
        console.timeEnd('Index creation');
        
        // Step 8: Re-enable trigger
        console.log('Re-enabling trigger...');
        await client.query('ALTER TABLE hotels ENABLE TRIGGER hotels_name_search_trigger');
        
        // Step 9: Drop temporary index
        await client.query('DROP INDEX IF EXISTS temp_hotel_code_idx');
        
        // Step 10: Vacuum and analyze for better performance
        console.log('Running VACUUM ANALYZE...');
        await client.query('VACUUM ANALYZE hotels');
        
        // Step 11: Final statistics
        const result = await client.query('SELECT COUNT(*) as total_hotels FROM hotels');
        console.log('\n=== IMPORT COMPLETED ===');
        console.log(`Total hotels in database: ${result.rows[0].total_hotels}`);
        console.log(`Successfully imported/updated: ${imported}`);
        console.log(`Failed imports: ${failed}`);
        
        if (failedHotels.length > 0) {
            console.log('\nFailed hotels (first 10):');
            failedHotels.slice(0, 10).forEach(f => {
                console.log(`  ${f.hotel_code}: ${f.error}`);
            });
            // Write failed hotels to file
            fs.writeFileSync('failed_imports.json', JSON.stringify(failedHotels, null, 2));
            console.log('Full list of failed hotels written to failed_imports.json');
        }
        
    } catch (error) {
        console.error('Import failed:', error);
        process.exit(1);
    } finally {
        await client.end();
        console.log('Database connection closed');
    }
}

// Handle memory and performance
process.on('warning', (warning) => {
    console.warn('Warning:', warning.name, warning.message);
});

// Run the import
importHotels();