import axios from "axios";
import { ApiError } from "../../utils/apiError.js";
import { prisma, Prisma } from '../../utils/prisma.js'

// Simple in-memory cache for search results (1 hour TTL)
const searchCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// In-flight deduplication: prevents concurrent identical requests from each firing
// separate TBO batch loops (which causes rate-limiting on shared TBO credentials).
const inFlightSearches = new Map(); // cacheKey -> Promise

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}, 60 * 1000); // Clean every minute

const presentageCommission = 5;

const formatDate = (dateStr) => {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = `0${date.getMonth() + 1}`.slice(-2);
  const day = `0${date.getDate()}`.slice(-2);
  return `${year}-${month}-${day}`;
};


export const search = async (req, res, next) => {
  try {
    const searchQuery = (req.query.q || "").trim();

    if (!searchQuery) {
      return res.status(400).json({ message: "Search text is required" });
    }

    /* ===============================
       1️⃣ Cities search (same table)
       =============================== */
    const cities = await prisma.hotel.findMany({
      where: {
        city_name: {
          contains: searchQuery,
          mode: "insensitive",
        },
      },
      distinct: ["city_code"],
      select: {
        city_name: true,
        city_code: true,
        country_name: true,
      },
      take: 10,
    });

    /* ===============================
       2️⃣ Hotels search (FULL-TEXT)
       =============================== */
    const hotels = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          hotel_id AS id,
          hotel_code,
          name,
          address,
          city_code,
          city_name,
          country_name,
          star_rating,
          image_urls
        FROM hotels
        WHERE name_search @@ plainto_tsquery(${searchQuery})
      `
    );

    // add type to cities
    const citiesWithType = cities.map(city => ({
      ...city,
      type: "city",
    }));

    // add type to hotels
    const hotelsWithType = hotels.map(hotel => ({
      ...hotel,
      type: "hotel",
    }));

    return res.json({
      cities: citiesWithType,
      hotels: hotelsWithType,
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for hotels"
      )
    );
  }
}


export const getCountryList = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;

    const reponse = await axios.get(`${baseURL}/CountryList`, {
      auth: {
        username: userName,
        password: password,
      },
    });
    return res.status(200).json({ data: reponse.data.CountryList });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for countries"
      )
    );
  }
};

export const getCityList = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;

    const { CountryCode } = req.body;

    const reponse = await axios.post(
      `${baseURL}/CityList`,
      {
        CountryCode,
      },
      {
        auth: {
          username: userName,
          password: password,
        },
      }
    );
    return res.status(200).json({ data: reponse.data.CityList });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for cities"
      )
    );
  }
};

const PER_PAGE = 30;
// === Helper: split array into chunks ===
const chunkArray = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

// === Helper: limit concurrency ===
const pLimit = (concurrency) => {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) queue.shift()();
  };

  const run = async (fn, resolve, args) => {
    activeCount++;
    const result = (async () => fn(...args))();
    result.then(resolve).then(next, next);
  };

  const enqueue = (fn, args) =>
    new Promise((resolve) => {
      queue.push(run.bind(null, fn, resolve, args));
      if (activeCount < concurrency) {
        queue.shift()();
      }
    });

  return (fn, ...args) => enqueue(fn, args);
};
// Optimized hotel search with progressive loading
// === Helper: apply filters, search, sort to a hotel list ===
const applyFiltersAndSort = (hotels, { nameSearch, sortBy, minPrice, maxPrice, starRatings }) => {
  let result = hotels;

  // Name search
  if (nameSearch && nameSearch.trim() !== '') {
    const q = nameSearch.trim().toLowerCase();
    result = result.filter(h => (h.name || '').toLowerCase().includes(q));
  }

  // Star rating filter (array of rating strings like ['Four', 'Five'])
  if (starRatings && starRatings.length > 0) {
    result = result.filter(h => starRatings.includes(h.star_rating));
  }

  // Price range filter
  const hasMinPrice = minPrice !== undefined && minPrice !== null;
  const hasMaxPrice = maxPrice !== undefined && maxPrice !== null;
if (hasMinPrice || hasMaxPrice) {
  result = result.filter(h => {
    const price = Number(h.MinHotelPrice);

    if (!price || isNaN(price)) return false;

    if (hasMinPrice && price < Number(minPrice)) return false;
    if (hasMaxPrice && price > Number(maxPrice)) return false;

    return true;
  });
}

  // Sort
  if (sortBy && sortBy !== 'none') {
    const ratingMap = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'price-asc':
          return (a.MinHotelPrice || 0) - (b.MinHotelPrice || 0);
        case 'price-desc':
          return (b.MinHotelPrice || 0) - (a.MinHotelPrice || 0);
        case 'star-asc':
          return (ratingMap[a.star_rating] || 0) - (ratingMap[b.star_rating] || 0);
        case 'star-desc':
          return (ratingMap[b.star_rating] || 0) - (ratingMap[a.star_rating] || 0);
        default:
          return 0;
      }
    });
  }

  return result;
};

// Helper: does this request have any active filter/sort/search that requires complete data?
const hasActiveFilters = ({ nameSearch, sortBy, minPrice, maxPrice, starRatings }) =>
  !!(nameSearch && nameSearch.trim()) ||
  (sortBy && sortBy !== 'none') ||
  minPrice !== undefined ||
  maxPrice !== undefined ||
  (starRatings && starRatings.length > 0);

export const searchHotels = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;

    const {
      CheckIn,
      CheckOut,
      Code,
      Type,
      GuestNationality,
      PreferredCurrencyCode = "SAR",
      PaxRooms,
      Language = "EN",
      page = 1,
      // Filter/sort/search params
      nameSearch,
      sortBy,
      minPrice,
      maxPrice,
      starRatings,
    } = req.body;


    

    // Step 0: Basic validation
    if (!Code || !Type || !CheckIn || !CheckOut || !PaxRooms || !GuestNationality) {
      return next(
        new ApiError(400, "Missing required fields for hotel search")
      );
    }

    // Step 1: Generate cache key
    const cacheKey = `search:${Code}:${Type}:${formatDate(CheckIn)}:${formatDate(CheckOut)}:${GuestNationality}:${JSON.stringify(PaxRooms)}`;

    // Step 2: Check cache
    const filterParams = { nameSearch, sortBy, minPrice, maxPrice, starRatings };
    const filtersActive = hasActiveFilters(filterParams);
    let cached = searchCache.get(cacheKey);

    if (cached) {
      const now = Date.now();
      const isExpired = now - cached.timestamp > CACHE_TTL;

      if (isExpired) {
        searchCache.delete(cacheKey);
        cached = null;
      } else {
        // We no longer force sync completion here so that the user can filter 
        // on the currently available (already loaded) hotels during background progressive loading.

        console.log(`✅ Returning cached results (${cached.availableHotels.length} hotels, complete: ${cached.isComplete})`);

        const filtered = applyFiltersAndSort(cached.availableHotels, filterParams);
        const startIndex = (page - 1) * PER_PAGE;
        const paginatedHotels = filtered.slice(startIndex, startIndex + PER_PAGE);

        if (paginatedHotels.length === 0 && page > 1) {
          return res.status(400).json({
            success: false,
            message: `No hotels found for page ${page}.`,
          });
        }

        return res.status(200).json({
          success: true,
          data: paginatedHotels,
          pagination: {
            page,
            perPage: PER_PAGE,
            total: filtered.length,
            totalPages: Math.ceil(filtered.length / PER_PAGE),
            isComplete: cached.isComplete,
          },
          cached: true,
        });
      }
    }

    console.log("🔍 Cache miss - fetching fresh data");

    // In-flight deduplication: if an identical search is already running, wait for it
    if (inFlightSearches.has(cacheKey)) {
      console.log(`⏳ Identical search already in-flight for key: ${cacheKey}. Waiting...`);
      try {
        await inFlightSearches.get(cacheKey);
        // After the in-flight search completes, the cache should be populated
        const freshCached = searchCache.get(cacheKey);
        if (freshCached) {
          const filtered = applyFiltersAndSort(freshCached.availableHotels, filterParams);
          const startIndex = (page - 1) * PER_PAGE;
          const paginatedHotels = filtered.slice(startIndex, startIndex + PER_PAGE);
          return res.status(200).json({
            success: true,
            data: paginatedHotels,
            pagination: {
              page,
              perPage: PER_PAGE,
              total: filtered.length,
              totalPages: Math.ceil(filtered.length / PER_PAGE),
              isComplete: freshCached.isComplete,
            },
            cached: true,
          });
        }
      } catch (err) {
        console.error('❌ In-flight search failed:', err.message);
      }
    }

    // Step 3: Fetch all hotels from database
    let allHotels;
    if (Type === "city") {
      allHotels = await prisma.hotel.findMany({
        where: { city_code: Code },
      });
    } else if (Type === "hotel") {
      const hotel = await prisma.hotel.findUnique({
        where: { hotel_code: Code },
      });
      allHotels = hotel ? [hotel] : [];
    }

    if (!allHotels || allHotels.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotels found for the selected code.",
      });
    }

    console.log(`📊 Found ${allHotels.length} hotels in database`);

    // Step 4: Progressive loading - process batches until we have enough for the requested page
    const BATCH_SIZE = 50;
    const availableHotels = [];
    const hotelMap = new Map(allHotels.map(h => [h.hotel_code, h]));

    // Calculate how many hotels we need for the requested page
    const hotelsNeededForPage = page * PER_PAGE;
    const BUFFER_SIZE = 20; // Extra buffer to account for low availability
    const targetForQuickResponse = hotelsNeededForPage + BUFFER_SIZE;

    let offset = 0;
    let batchNumber = 1;
    let shouldReturnEarly = false;

    // Register this search as in-flight so any concurrent duplicate request waits on it
    let resolveInFlight, rejectInFlight;
    const inFlightPromise = new Promise((resolve, reject) => {
      resolveInFlight = resolve;
      rejectInFlight = reject;
    });
    inFlightSearches.set(cacheKey, inFlightPromise);

    // Process batches until we have enough for the requested page
    let consecutiveEmptyBatches = 0;
    const WARN_CONSECUTIVE_EMPTY = 5; // Log a warning if this many full batches in a row return 0 (possible rate-limit signal)

    while (offset < allHotels.length && !shouldReturnEarly) {
      const batch = allHotels.slice(offset, offset + BATCH_SIZE);
      const batchCodes = batch.map(h => h.hotel_code);

      console.log(`🔄 Processing batch ${batchNumber}: ${batchCodes.length} hotels (offset: ${offset})`);

      try {
        // Check TBO availability for this batch
        const response = await axios.post(
          `${baseURL}/Search`,
          {
            CheckIn: formatDate(CheckIn),
            CheckOut: formatDate(CheckOut),
            HotelCodes: batchCodes.join(","),
            GuestNationality,
            PreferredCurrencyCode,
            PaxRooms,
            ResponseTime: 23.0,
            IsDetailedResponse: true,
            Filters: {
              Refundable: false,
              NoOfRooms: 20,
              MealType: "All",
            },
          },
          {
            auth: { username: userName, password },
            timeout: 30000, // 30s timeout — don't hang forever on TBO slowness
          }
        );

        const batchResults = response.data?.HotelResult || [];
        console.log(`✅ Batch ${batchNumber}: ${batchResults.length} hotels available`);

        // Track consecutive empty batches for diagnostic purposes only — do NOT stop early,
        // because a later batch may still contain available hotels.
        if (batchResults.length === 0 && batchCodes.length === BATCH_SIZE) {
          consecutiveEmptyBatches++;
          if (consecutiveEmptyBatches === WARN_CONSECUTIVE_EMPTY) {
            console.warn(`⚠️  ${consecutiveEmptyBatches} consecutive full batches returned 0 hotels — possible TBO rate-limiting on shared credentials. Continuing search...`);
          }
        } else {
          if (consecutiveEmptyBatches >= WARN_CONSECUTIVE_EMPTY) {
            console.log(`✅ Batch ${batchNumber} recovered with ${batchResults.length} results after ${consecutiveEmptyBatches} empty batches.`);
          }
          consecutiveEmptyBatches = 0;
        }

        // Merge hotel details with TBO results
        for (const tboHotel of batchResults) {
          const dbHotel = hotelMap.get(tboHotel.HotelCode);
          if (dbHotel) {
            availableHotels.push({
              ...dbHotel,
              ...tboHotel,
              MinHotelPrice: tboHotel?.Rooms?.[0]?.DayRates?.[0]?.[0]?.BasePrice || null,
              presentageCommission,
            });
          }
        }

        // Check if we have enough hotels for the requested page
        if (availableHotels.length >= targetForQuickResponse) {
          console.log(`🎯 Got ${availableHotels.length} hotels - enough for page ${page}. Returning early.`);
          shouldReturnEarly = true;
        }

      } catch (error) {
        console.error(`❌ Error processing batch ${batchNumber}:`, error.message);
        // Continue with next batch even if this one fails
      }

      offset += BATCH_SIZE;
      batchNumber++;
    }

    const isComplete = offset >= allHotels.length;
    console.log(`📦 Processed ${offset}/${allHotels.length} hotels. Available: ${availableHotels.length}. Complete: ${isComplete}`);

    // Step 5: Cache the results (store allDbHotels + hotelMap for sync-complete resumability)
    searchCache.set(cacheKey, {
      availableHotels,
      allDbHotels: allHotels,   // full DB list – needed to resume when filters applied
      hotelMap,                  // needed to merge TBO results on resume
      timestamp: Date.now(),
      isComplete,
      totalProcessed: offset,
      totalHotels: allHotels.length,
    });

    // Resolve the in-flight promise so any waiting duplicate requests can use the cache
    inFlightSearches.delete(cacheKey);
    resolveInFlight();

    // Step 6: Continue processing remaining hotels in background (if not complete)
    if (!isComplete && availableHotels.length > 0) {
      console.log(`🔄 Starting background processing for remaining ${allHotels.length - offset} hotels`);

      // Process remaining hotels asynchronously
      setImmediate(async () => {
        try {
          const remainingAvailableHotels = [...availableHotels];
          let bgOffset = offset;
          let bgBatchNumber = batchNumber;

          while (bgOffset < allHotels.length) {
            const batch = allHotels.slice(bgOffset, bgOffset + BATCH_SIZE);
            const batchCodes = batch.map(h => h.hotel_code);

            console.log(`🔄 [Background] Processing batch ${bgBatchNumber}: ${batchCodes.length} hotels`);

            try {
              const response = await axios.post(
                `${baseURL}/Search`,
                {
                  CheckIn: formatDate(CheckIn),
                  CheckOut: formatDate(CheckOut),
                  HotelCodes: batchCodes.join(","),
                  GuestNationality,
                  PreferredCurrencyCode,
                  PaxRooms,
                  ResponseTime: 23.0,
                  IsDetailedResponse: true,
                  Filters: {
                    Refundable: false,
                    NoOfRooms: 20,
                    MealType: "All",
                  },
                },
                {
                  auth: { username: userName, password },
                }
              );

              const batchResults = response.data?.HotelResult || [];
              console.log(`✅ [Background] Batch ${bgBatchNumber}: ${batchResults.length} hotels available`);

              for (const tboHotel of batchResults) {
                const dbHotel = hotelMap.get(tboHotel.HotelCode);
                if (dbHotel) {
                  remainingAvailableHotels.push({
                    ...dbHotel,
                    ...tboHotel,
                    MinHotelPrice: tboHotel?.Rooms?.[0]?.DayRates?.[0]?.[0]?.BasePrice || null,
                    presentageCommission,
                  });
                }
              }

              // Update cache only if we have MORE hotels than currently cached
              // (guards against overwriting a sync-complete result with a partial one)
              const existingCached = searchCache.get(cacheKey);
              if (!existingCached || remainingAvailableHotels.length >= existingCached.availableHotels.length) {
                searchCache.set(cacheKey, {
                  ...(existingCached || {}),
                  availableHotels: remainingAvailableHotels,
                  timestamp: existingCached?.timestamp || Date.now(),
                  isComplete: bgOffset + BATCH_SIZE >= allHotels.length,
                  totalProcessed: bgOffset + BATCH_SIZE,
                  totalHotels: allHotels.length,
                });
              }

            } catch (error) {
              console.error(`❌ [Background] Error processing batch ${bgBatchNumber}:`, error.message);
            }

            bgOffset += BATCH_SIZE;
            bgBatchNumber++;
          }

          console.log(`✅ [Background] Processing complete. Total available: ${remainingAvailableHotels.length}`);
        } catch (error) {
          console.error('❌ [Background] Fatal error:', error.message);
        }
      });
    }

    // Step 7: Apply filter/sort/search on full list, then paginate
    const filteredHotels = applyFiltersAndSort(availableHotels, { nameSearch, sortBy, minPrice, maxPrice, starRatings });
    const startIndex = (page - 1) * PER_PAGE;
    const paginatedHotels = filteredHotels.slice(startIndex, startIndex + PER_PAGE);

    if (filteredHotels.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotels match the selected filters.",
      });
    }

    if (paginatedHotels.length === 0 && filteredHotels.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Page ${page} is out of range. Total pages available: ${Math.ceil(filteredHotels.length / PER_PAGE)}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: paginatedHotels,
      pagination: {
        page,
        perPage: PER_PAGE,
        total: filteredHotels.length,
        totalPages: Math.ceil(filteredHotels.length / PER_PAGE),
        isComplete,
      },
      cached: false,
    });

  } catch (error) {
    // If this request had registered an in-flight promise, reject it so waiters unblock
    if (typeof rejectInFlight === 'function') {
      inFlightSearches.delete(cacheKey);
      rejectInFlight(error);
    }
    console.error(
      "Hotel search error:",
      error?.response?.data || error.message
    );
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for hotels"
      )
    );
  }
}

// === Main Controller ===
export const hotelsSearch = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;

    const {
      CheckIn,
      CheckOut,
      CityCode,
      GuestNationality,
      PreferredCurrencyCode = "SAR",
      PaxRooms,
      Language = "EN",
      page = 1,
    } = req.body;

    // Step 0: Basic validation
    if (!CityCode || !CheckIn || !CheckOut || !PaxRooms || !GuestNationality) {
      return next(
        new ApiError(400, "Missing required fields for hotel search")
      );
    }

    // Step 1: Fetch hotel codes for the city
    const hotelCodesRes = await axios.post(
      `${baseURL}/TBOHotelCodeList`,
      { CityCode },
      { auth: { username: userName, password } }
    );

    const allHotelCodes =
      hotelCodesRes.data?.Hotels?.map((h) => h.HotelCode) || [];

    if (allHotelCodes.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotel codes found for the selected city.",
      });
    }

    // Step 2: Fetch available rooms in hotels (batched + concurrent)
    const limit = pLimit(10); // max 10 parallel requests
    const hotelChunks = chunkArray(allHotelCodes, 50); // each request ≤ 50 codes
    const batchChunks = chunkArray(hotelChunks, 10); // group 10x50 = 500 per cycle

    let searchResults = [];
    for (const batch of batchChunks) {
      const results = await Promise.all(
        batch.map((codes, indx) => {
          return limit(() =>
            axios.post(
              `${baseURL}/Search`,
              {
                CheckIn: formatDate(CheckIn),
                CheckOut: formatDate(CheckOut),
                HotelCodes: codes.join(","), // max 50
                GuestNationality,
                PreferredCurrencyCode,
                PaxRooms,
                ResponseTime: 23.0,
                IsDetailedResponse: true,
                Filters: {
                  Refundable: false,
                  NoOfRooms: 20,
                  MealType: "All",
                },
              },
              {
                auth: { username: userName, password },
              }
            )
          );
        })
      );

      const batchResults = results.flatMap((r) => r.data?.HotelResult || []);
      searchResults = [...searchResults, ...batchResults];
    }

    const aviailableHotelCodes = searchResults.map((r) => r.HotelCode);

    // Step 3: Paginate available hotel codes
    const startIndex = (page - 1) * PER_PAGE;
    const currentBatchArray = aviailableHotelCodes.slice(
      startIndex,
      startIndex + PER_PAGE
    );

    if (currentBatchArray.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No hotels found for page ${page}.`,
      });
    }

    const currentBatch = currentBatchArray.join(",");

    // Step 4: Fetch hotel details
    const hotelDetailsRes = await axios.post(
      `${baseURL}/HotelDetails`,
      { Hotelcodes: currentBatch, Language },
      { auth: { username: userName, password } }
    );

    const hotelDetails = hotelDetailsRes.data?.HotelDetails || [];

    // Step 5: Merge hotel details with pricing
    const enrichedHotels = hotelDetails.map((hotel) => {
      const matched = searchResults.find(
        (result) => result.HotelCode === hotel.HotelCode
      );
      return {
        ...hotel,
        ...matched,
        MinHotelPrice:
          matched?.Rooms?.[0]?.DayRates?.[0]?.[0]?.BasePrice || null,
        presentageCommission,
      };
    });

    // Step 6: Return results
    return res.status(200).json({
      success: true,
      data: enrichedHotels,
      pagination: {
        page,
        perPage: PER_PAGE,
        total: aviailableHotelCodes.length,
        totalPages: Math.ceil(aviailableHotelCodes.length / PER_PAGE),
      },
    });
  } catch (error) {
    console.error(
      "Hotel search error:",
      error?.response?.data || error.message
    );
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for hotels"
      )
    );
  }
};

export const getHotelDetails = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;
    const {
      CheckIn,
      CheckOut,
      CityCode,
      HotelCodes,
      GuestNationality,
      PreferredCurrencyCode = "SAR",
      PaxRooms,
      Language = "EN",
    } = req.body;

    if (!HotelCodes) {
      return next(new ApiError(400, "Hotel codes are required"));
    }

    const hotelSearchPayload = {
      CheckIn: formatDate(CheckIn),
      CheckOut: formatDate(CheckOut),
      HotelCodes,
      GuestNationality,
      PreferredCurrencyCode,
      PaxRooms,
      ResponseTime: 23.0,
      IsDetailedResponse: true,
      Filters: {
        Refundable: false,
        NoOfRooms: 50,
        MealType: "All",
      },
    };

    const hotelDetails = await axios.post(
      `${baseURL}/HotelDetails`,
      { HotelCodes, Language },
      {
        auth: {
          username: userName,
          password,
        },
      }
    );

    const hotel = hotelDetails.data.HotelDetails;


    const getRooms = await axios.post(`${baseURL}/Search`, hotelSearchPayload, {
      auth: { username: userName, password },
    });

    console.log(getRooms.data, "getRooms");

    let availableRooms = [];
    if (getRooms.data?.HotelResult?.[0]?.Rooms) {
      availableRooms = getRooms.data.HotelResult[0].Rooms;
    } else if (
      getRooms.data?.Status?.Code === 201 ||
      getRooms.data?.Status?.Description?.includes("No Available rooms")
    ) {
      console.log("No rooms available for this hotel (TBO 201)");
      availableRooms = [];
    } else {
      console.warn("Unexpected room search response:", getRooms.data);
    }

    return res.status(200).json({
      data: {
        hotel,
        availableRooms,
        presentageCommission,
      },
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for Hotel Details "
      )
    );
  }
};

export const preBookRoom = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL,
      { BookingCode } = req.body;

    const response = await axios.post(
      `${baseURL}/PreBook`,
      {
        BookingCode,
        PaymentMode: "NewCard",
      },
      { auth: { username: userName, password } }
    );

    return res.status(200).json({
      data: response.data,
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for Hotel Details "
      )
    );
  }
};

export const bookRoom = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;

    const {
      BookingCode,
      CustomerDetails,
      ClientReferenceId,
      BookingReferenceId,
      TotalFare,
      EmailId,
      PhoneNumber,
      BookingType,
      PaymentMode,
      Supplements, // optional
    } = req.body;

    // Compose the request payload
    const payload = {
      BookingCode,
      CustomerDetails,
      ClientReferenceId,
      BookingReferenceId,
      TotalFare,
      EmailId,
      PhoneNumber,
      BookingType,
      PaymentMode,
    };

    if (Supplements && Supplements.length > 0) {
      payload.Supplements = Supplements;
    }

    const response = await axios.post(`${baseURL}/Book`, payload, {
      auth: { username: userName, password },
    });

    return res.status(200).json({
      success: true,
      message: "Booking successful",
      data: response.data,
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        "Error searching for Hotel Details"
      )
    );
  }
};

export const BookingDetails = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME,
      password = process.env.TBO_LIVE_PASSWORD,
      baseURL = process.env.TBO_LIVE_URL;

    const { BookingReferenceId } = req.body;

    if (!BookingReferenceId) {
      return res.status(400).json({
        success: false,
        message: "BookingReferenceId is required",
      });
    }

    const detailsResponse = await axios.post(
      `${baseURL}/BookingDetail`,
      {
        BookingReferenceId: BookingReferenceId,
        PaymentMode: "PayLater", // or the mode you actually use
      },
      {
        auth: {
          username: userName,
          password: password,
        },
      }
    );

    // forward TBO API response to client
    return res.status(200).json({
      success: true,
      data: detailsResponse.data,
    });
  } catch (error) {
    console.error("BookingDetails error:", error?.response?.data || error);

    return next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        error.response?.data?.error ||
        "Error fetching booking details from TBO"
      )
    );
  }
};
export const getRandomHotels = async (req, res, next) => {
  try {
    const userName = process.env.TBO_LIVE_USER_NAME;
    const password = process.env.TBO_LIVE_PASSWORD;
    const baseURL = process.env.TBO_LIVE_URL;

    const { cities } = req.body;
    const cityList = Array.isArray(cities) ? cities : cities.split(",");

    const stayDays = [2, 3, 4];
    const today = new Date();
    const checkIn = new Date(today);
    checkIn.setDate(today.getDate() + 30);

    const formatDate = (date) => date.toISOString().split("T")[0];

    const availableHotels = [];

    for (const cityCode of cityList) {
      // Step 1️⃣: Fetch hotel codes in the city
      const hotelCodesRes = await axios.post(
        `${baseURL}/TBOHotelCodeList`,
        { CityCode: cityCode },
        { auth: { username: userName, password } }
      );

      const hotels = hotelCodesRes.data?.Hotels || [];

      if (!hotels.length) {
        console.log(`❌ No hotels found for city ${cityCode}`);
        continue;
      }

      // Step 2️⃣: Pick a random hotel and search for availability
      let selectedHotel = null;
      let tries = 0;

      while (!selectedHotel && tries < 3) {
        tries++;
        const randomHotel = hotels[Math.floor(Math.random() * hotels.length)];
        const randomStay =
          stayDays[Math.floor(Math.random() * stayDays.length)];
        const checkOut = new Date(checkIn);
        checkOut.setDate(checkIn.getDate() + randomStay);

        const payload = {
          CheckIn: formatDate(checkIn),
          CheckOut: formatDate(checkOut),
          HotelCodes: randomHotel.HotelCode,
          GuestNationality: "US",
          PaxRooms: [{ Adults: 2, Children: 0, ChildrenAges: [] }],
          ResponseTime: 23.0,
          IsDetailedResponse: true,
          Filters: { Refundable: false, NoOfRooms: 20, MealType: "All" },
        };

        try {
          const searchRes = await axios.post(`${baseURL}/Search`, payload, {
            auth: { username: userName, password },
          });

          const hotelsFound = searchRes.data?.HotelResult || [];

          if (hotelsFound.length > 0) {
            selectedHotel = {
              cityCode,
              hotelCode: randomHotel.HotelCode,
              hotelName: randomHotel.HotelName,
              stay: randomStay,
              checkIn: formatDate(checkIn),
              checkOut: formatDate(checkOut),
              rooms: hotelsFound[0]?.Rooms || [],
            };
            availableHotels.push(selectedHotel);
          } else {
            console.log(
              `❌ No available rooms for hotel ${randomHotel.HotelCode}`
            );
          }
        } catch (searchError) {
          console.error(
            `🚨 Search error for hotel ${randomHotel.HotelCode}:`,
            searchError.message
          );
        }
      }

      if (!selectedHotel) {
        console.log(
          `💥 Failed to find available hotel for city ${cityCode} after 3 attempts`
        );
      }
    }

    if (availableHotels.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotels found with available rooms.",
      });
    }

    // Step 3️⃣: Get details for the selected hotels
    const hotelCodes = availableHotels.map((h) => h.hotelCode).join(",");

    const hotelDetailsRes = await axios.post(
      `${baseURL}/HotelDetails`,
      { Hotelcodes: hotelCodes, Language: "EN" },
      { auth: { username: userName, password } }
    );

    const detailedHotels = hotelDetailsRes.data?.HotelDetails || [];
    console.log(`📄 Retrieved details for ${detailedHotels.length} hotels`);

    // Step 4️⃣: Merge details with availability
    const merged = availableHotels.map((avail) => {
      const detail = detailedHotels.find(
        (d) => d.HotelCode === avail.hotelCode
      );
      return { ...avail, ...detail };
    });

    return res.status(200).json({
      success: true,
      count: merged.length,
      data: merged,
    });
  } catch (error) {
    console.error("❌ getRandomHotels error:", error.response?.data || error);
    return next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail ||
        error.response?.data?.error ||
        "Error fetching random hotels from TBO"
      )
    );
  }
};
