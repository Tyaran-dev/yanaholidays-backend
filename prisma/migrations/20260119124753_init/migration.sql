-- CreateTable
CREATE TABLE "hotels" (
    "hotel_id" TEXT NOT NULL,
    "hotel_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city_code" TEXT NOT NULL,
    "city_name" TEXT,
    "country_name" TEXT,
    "star_rating" TEXT,
    "image_urls" TEXT[],

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("hotel_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hotels_hotel_code_key" ON "hotels"("hotel_code");
