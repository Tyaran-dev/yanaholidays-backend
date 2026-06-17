import express from "express";
const router = express.Router();
import {
  getCountryList,
  getCityList,
  hotelsSearch,
  getHotelDetails,
  preBookRoom,
  bookRoom,
  BookingDetails,
  getRandomHotels,
  search,
  searchHotels
} from "../../controllers/hotels/hotels.controller.js";

router.get("/CountryList", getCountryList);
router.get("/search", search);
router.post("/searchHotels", searchHotels);
router.post("/CityList", getCityList);
router.post("/HotelsSearch", hotelsSearch);
router.post("/HotelDetails", getHotelDetails);
router.post("/PreBookRoom", preBookRoom);
router.post("/BookRoom", bookRoom);
router.post("/BookingDetail", BookingDetails);
router.post("/RandomHotels", getRandomHotels);

export default router;
