import {
  UtensilsCrossed,
  Home as HomeIcon,
  Shirt,
  Smartphone,
  Wrench,
  ShoppingBag,
  RefreshCcw,
  Clapperboard,
  Baby,
  PawPrint,
  Car,
  MoreHorizontal,
  Sofa,
  HardHat,
  BriefcaseBusiness,
  Dumbbell,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface CategoryDef {
  key: string;
  displayShort: string;
  icon: LucideIcon;
  color: string;
  badgeColor: string;
  tagline: string;
  subcategories: string[];
}

export const CATEGORY_DEFS: CategoryDef[] = [
  // ============================================================
  // FOOD & GROCERIES
  // ============================================================
  {
    key: "Food & Groceries",
    displayShort: "Food",
    icon: UtensilsCrossed,
    color: "text-amber-600 bg-amber-50 border-amber-300",
    badgeColor: "bg-amber-100 text-amber-700",
    tagline: "Groceries, fresh produce, cooked food, restaurants and hotels",
    subcategories: [
      "Groceries",
      "Fresh Produce",
      "Fruits & Vegetables",
      "Meat & Poultry",
      "Fish & Seafood",
      "Dairy Products",
      "Beverages",
      "Restaurants & Cooked Food",
      "Bakeries",
      "Hotels / Eateries",
      "Catering Services",
      "Food Delivery",
      "Other Food & Groceries",
    ],
  },

  // ============================================================
  // HOUSES, RENTALS & RESIDENTIAL PROPERTY
  // ============================================================
  {
    key: "Accommodation",
    displayShort: "Housing",
    icon: HomeIcon,
    color: "text-indigo-600 bg-indigo-50 border-indigo-300",
    badgeColor: "bg-indigo-100 text-indigo-700",
    tagline:
      "Rooms, bedsitters, apartments, houses, short stays and residential property",
    subcategories: [
      // Rooms & bedsitters
      "Single Rooms",
      "Bedsitters",
      "Studios",

      // Apartments by bedroom count
      "1 Bedroom Apartments",
      "2 Bedroom Apartments",
      "3 Bedroom Apartments",
      "4+ Bedroom Apartments",

      // Houses by bedroom count
      "1 Bedroom Houses",
      "2 Bedroom Houses",
      "3 Bedroom Houses",
      "4+ Bedroom Houses",

      // Other residential property
      "Houses to Rent",
      "Apartments to Rent",
      "Houses for Sale",
      "Apartments for Sale",
      "Hostels & Student Housing",
      "Serviced Apartments",
      "Furnished Apartments",
      "Maisonettes",
      "Bungalows",
      "Townhouses",
      "Gated Community Homes",

      // Short stays
      "Airbnb / Short Stays",
      "Lodges / Guest Houses",
      "Vacation Rentals",

      // Land
      "Residential Land for Sale",
      "Residential Land for Rent",

      // Other
      "Roommates / Shared Housing",
      "Parking Spaces",
      "Garages",
      "Other Accommodation",
    ],
  },

  // ============================================================
  // FASHION & CLOTHING
  // ============================================================
  {
    key: "Fashion & Clothing",
    displayShort: "Fashion",
    icon: Shirt,
    color: "text-purple-600 bg-purple-50 border-purple-300",
    badgeColor: "bg-purple-100 text-purple-700",
    tagline:
      "Clothes, shoes, bags, accessories, beauty, jewellery and fashion services",
    subcategories: [
      "Men's Clothing",
      "Women's Clothing",
      "Kids' Clothing",
      "Baby Clothing",
      "Traditional Wear",
      "Wedding & Bridal Wear",
      "Suits & Formal Wear",
      "Sportswear",
      "Underwear & Lingerie",

      "Shoes",
      "Men's Shoes",
      "Women's Shoes",
      "Kids' Shoes",
      "Sports Shoes",

      "Bags & Accessories",
      "Handbags",
      "Backpacks",
      "Wallets & Purses",
      "Belts",
      "Hats & Caps",
      "Sunglasses",

      "Watches",
      "Jewelry",
      "Gold & Precious Jewelry",
      "Fashion Jewelry",

      "Beauty & Cosmetics",
      "Makeup & Cosmetics",
      "Skincare",
      "Hair Products",
      "Perfumes & Fragrances",

      "Fashion Services",
      "Tailoring & Dressmaking",
      "Clothing Alterations",
      "Barbers & Hair Salons",
      "Beauty Salons",
      "Nail Services",
      "Fashion Design",

      "Other Fashion",
    ],
  },

  // ============================================================
  // ELECTRONICS & TECHNOLOGY
  // ============================================================
  {
    key: "Electronics & Tech",
    displayShort: "Electronics",
    icon: Smartphone,
    color: "text-blue-600 bg-blue-50 border-blue-300",
    badgeColor: "bg-blue-100 text-blue-700",
    tagline:
      "Phones, computers, TVs, electronics, accessories, repairs and digital services",
    subcategories: [
      "Phones",
      "Smartphones",
      "Basic Phones",
      "Tablets",

      "Laptops & Computers",
      "Desktop Computers",
      "Laptops",
      "Monitors",
      "Computer Accessories",

      "TVs & Home Entertainment",
      "Televisions",
      "Speakers & Sound Systems",
      "Home Theatre Systems",
      "Gaming Consoles",
      "Video Games",

      "Cameras & Photography Equipment",
      "Cameras",
      "Camera Lenses",
      "Photography Accessories",

      "Accessories",
      "Phone Accessories",
      "Chargers & Cables",
      "Power Banks",
      "Headphones & Earphones",
      "Smart Watches",

      "Networking",
      "WiFi Routers",
      "Modems",
      "Networking Equipment",

      "Repairs & Tech Services",
      "Phone Repairs",
      "Computer Repairs",
      "TV Repairs",
      "Electronics Repairs",
      "Software & IT Services",

      "Cyber / Printing Services",
      "Cyber Services",
      "Printing & Photocopying",
      "Graphic Design",
      "Internet Services",

      "Other Electronics & Tech",
    ],
  },

  // ============================================================
  // SERVICES
  // ============================================================
  {
    key: "Services",
    displayShort: "Services",
    icon: Wrench,
    color: "text-teal-600 bg-teal-50 border-teal-300",
    badgeColor: "bg-teal-100 text-teal-700",
    tagline:
      "Professional, home, repair, construction, personal, business and other services",
    subcategories: [
      // Home services
      "Cleaning Services",
      "Laundry Services",
      "Moving & Relocation",
      "Pest Control",
      "Gardening & Landscaping",
      "Home Security",

      // Repair
      "Phone & Computer Repair",
      "Electronics Repair",
      "Appliance Repair",
      "Furniture Repair",
      "Shoe & Leather Repair",
      "Watch Repair",

      // Construction & skilled trades
      "Construction Contractors",
      "Masonry",
      "Carpentry",
      "Plumbing",
      "Electrical Services",
      "Welding & Metalwork",
      "Painting & Decoration",
      "Roofing",
      "Tiling",
      "Glass & Aluminium",
      "Renovation Services",
      "Interior Design",

      // Professional
      "Accounting & Bookkeeping",
      "Legal Services",
      "Consulting",
      "Marketing & Advertising",
      "Real Estate Services",
      "Insurance Services",

      // Personal
      "Beauty & Personal Care",
      "Photography",
      "Videography",
      "Tutoring & Education",
      "Fitness Training",

      // Jobs
      "Job Seeking & CVs",
      "Freelance Services",

      // Business & digital
      "Business & Digital Services",
      "Web & App Development",
      "Graphic Design",
      "Social Media Services",
      "Printing Services",

      // Delivery & transport
      "Delivery Services",
      "Courier Services",
      "Transport Services",
      "Moving Services",

      "Other Services",
    ],
  },

  // ============================================================
  // GENERAL PRODUCTS
  // ============================================================
  {
    key: "General Products",
    displayShort: "Products",
    icon: ShoppingBag,
    color: "text-orange-600 bg-orange-50 border-orange-300",
    badgeColor: "bg-orange-100 text-orange-700",
    tagline:
      "Household items, farm supplies, hardware, tools and miscellaneous products",
    subcategories: [
      "Household Items",
      "Kitchen Items",
      "Home Décor",
      "Cleaning Products",
      "Hardware & Tools",
      "Building Materials",
      "Farm Supplies",
      "Farming Inputs",
      "Seeds & Seedlings",
      "Fertilizers",
      "Animal Feeds",
      "Office Supplies",
      "Stationery",
      "Packaging Materials",
      "Miscellaneous Products",
    ],
  },

  // ============================================================
  // HOME, FURNITURE & APPLIANCES
  // ============================================================
  {
    key: "Home, Furniture & Appliances",
    displayShort: "Home & Furniture",
    icon: Sofa,
    color: "text-rose-600 bg-rose-50 border-rose-300",
    badgeColor: "bg-rose-100 text-rose-700",
    tagline:
      "Furniture, home appliances, kitchen appliances, décor and household equipment",
    subcategories: [
      // Furniture
      "Sofas & Couches",
      "Beds",
      "Mattresses",
      "Tables",
      "Chairs",
      "Dining Sets",
      "Wardrobes",
      "Cabinets",
      "TV Stands",
      "Office Furniture",
      "Outdoor Furniture",
      "Kids' Furniture",

      // Home décor
      "Home Décor",
      "Curtains & Blinds",
      "Carpets & Rugs",
      "Mirrors",
      "Wall Art",
      "Lighting",

      // Kitchen appliances
      "Cookers & Ovens",
      "Microwaves",
      "Blenders & Mixers",
      "Electric Kettles",
      "Coffee Machines",

      // Major appliances
      "Refrigerators & Freezers",
      "Washing Machines",
      "Dryers",
      "Dishwashers",

      // Entertainment
      "TVs",
      "Home Theatre",
      "Speakers",

      // Other
      "Small Appliances",
      "Household Appliances",
      "Furniture for Sale",
      "Furniture for Hire",
      "Other Home & Furniture",
    ],
  },

  // ============================================================
  // COMMERCIAL EQUIPMENT & TOOLS
  // ============================================================
  {
    key: "Commercial Equipment & Tools",
    displayShort: "Equipment & Tools",
    icon: HardHat,
    color: "text-red-600 bg-red-50 border-red-300",
    badgeColor: "bg-red-100 text-red-700",
    tagline:
      "Commercial, industrial, construction, farming and professional equipment for sale or hire",
    subcategories: [
      // Construction
      "Construction Equipment",
      "Construction Tools",
      "Concrete Mixers",
      "Scaffolding",
      "Ladders",

      // Tools
      "Power Tools",
      "Hand Tools",
      "Welding Equipment",
      "Workshop Equipment",

      // Business
      "Restaurant & Hotel Equipment",
      "Commercial Kitchen Equipment",
      "Salon & Barber Equipment",
      "Office Equipment",
      "Printing Equipment",
      "Car Wash Equipment",
      "Cleaning Equipment",

      // Industrial
      "Industrial Equipment",
      "Generators",
      "Compressors",
      "Pumps",
      "Refrigeration Equipment",

      // Agriculture
      "Farming Equipment",
      "Agricultural Machinery",

      // Transport
      "Commercial Vehicles & Equipment",

      // Sale / hire
      "Equipment for Sale",
      "Equipment for Hire",
      "Equipment Rental",

      "Other Commercial Equipment",
    ],
  },

  // ============================================================
  // SECOND-HAND / USED ITEMS
  // ============================================================
  {
    key: "Second-Hand / Used Items",
    displayShort: "2nd Hand",
    icon: RefreshCcw,
    color: "text-yellow-600 bg-yellow-50 border-yellow-300",
    badgeColor: "bg-yellow-100 text-yellow-700",
    tagline:
      "Used phones, electronics, furniture, clothing, appliances and other pre-owned items",
    subcategories: [
      "Used Phones & Electronics",
      "Used Computers & Laptops",
      "Used Furniture",
      "Used Home Appliances",
      "Used Household Items",
      "Mtumba / Used Clothing",
      "Used Shoes & Bags",
      "Used Tools & Equipment",
      "Used Vehicles",
      "Other Used Items",
    ],
  },

  // ============================================================
  // EVENTS & ENTERTAINMENT
  // ============================================================
  {
    key: "Entertainment & Events",
    displayShort: "Events",
    icon: Clapperboard,
    color: "text-pink-600 bg-pink-50 border-pink-300",
    badgeColor: "bg-pink-100 text-pink-700",
    tagline:
      "Events, venues, DJs, photography, catering, entertainment and event services",
    subcategories: [
      // Events
      "Weddings",
      "Birthdays & Parties",
      "Corporate Events",
      "Conferences",
      "Concerts & Festivals",
      "Graduations",
      "Church & Religious Events",

      // Venues
      "Event Venues",
      "Wedding Venues",
      "Conference Venues",
      "Party Venues",

      // Entertainment
      "Clubs & Gaming",
      "DJs & Entertainment",
      "Live Bands & Musicians",
      "MCs & Hosts",
      "Comedy & Performers",

      // Event services
      "Event Planning",
      "Event Decoration",
      "Photography & Videography",
      "Catering",
      "Tents, Chairs & Tables",
      "Sound & Lighting Equipment",
      "Event Equipment Hire",

      "Other Events & Entertainment",
    ],
  },

  // ============================================================
  // LEISURE & ACTIVITIES
  // ============================================================
  {
    key: "Leisure & Activities",
    displayShort: "Leisure",
    icon: Dumbbell,
    color: "text-emerald-600 bg-emerald-50 border-emerald-300",
    badgeColor: "bg-emerald-100 text-emerald-700",
    tagline:
      "Sports, fitness, outdoor activities, hobbies, travel, tours and recreation",
    subcategories: [
      "Sports Equipment",
      "Football & Sports",
      "Gym & Fitness",
      "Fitness Trainers",
      "Swimming",
      "Cycling & Bicycles",
      "Camping & Hiking",
      "Outdoor Activities",
      "Fishing",
      "Travel & Tours",
      "Tour Guides",
      "Game Parks & Attractions",
      "Musical Instruments",
      "Art & Crafts",
      "Books & Hobbies",
      "Board Games",
      "Games & Toys",
      "Recreational Services",
      "Other Leisure & Activities",
    ],
  },

  // ============================================================
  // BABIES & KIDS
  // ============================================================
  {
    key: "Babies & Kids",
    displayShort: "Babies & Kids",
    icon: Baby,
    color: "text-cyan-600 bg-cyan-50 border-cyan-300",
    badgeColor: "bg-cyan-100 text-cyan-700",
    tagline:
      "Baby products, kids' items, childcare and children's activities",
    subcategories: [
      "Baby Products",
      "Kids' Clothes",
      "Kids' Shoes",
      "Toys & Games",
      "Baby Furniture",
      "Strollers & Car Seats",
      "Diapers & Baby Care",
      "School Uniforms",
      "Kids' Books & Learning",
      "Daycare & Childcare",
      "Babysitters & Nannies",
      "Kids' Activities",
      "Kids' Birthday Parties",
    ],
  },

  // ============================================================
  // ANIMALS & PETS
  // ============================================================
  {
    key: "Animals & Pets",
    displayShort: "Animals & Pets",
    icon: PawPrint,
    color: "text-lime-600 bg-lime-50 border-lime-300",
    badgeColor: "bg-lime-100 text-lime-700",
    tagline:
      "Pets, livestock, poultry, animal products, feeds and services",
    subcategories: [
      "Dogs & Cats",
      "Birds",
      "Other Pets",
      "Pet Products",
      "Pet Services",
      "Livestock",
      "Poultry",
      "Animal Feeds",
    ],
  },

  // ============================================================
  // VEHICLES
  // ============================================================
  {
    key: "Vehicles",
    displayShort: "Vehicles",
    icon: Car,
    color: "text-slate-600 bg-slate-50 border-slate-300",
    badgeColor: "bg-slate-100 text-slate-700",
    tagline:
      "Cars, motorcycles, tuk-tuks, bicycles, spare parts and vehicle services",
    subcategories: [
      "Cars",
      "Motorcycles",
      "Tuk-tuks",
      "Bicycles",
      "Trucks & Lorries",
      "Vans",
      "Vehicle Spare Parts",
      "Vehicle Accessories",
      "Car Hire",
      "Vehicle Hire",
      "Vehicle Repair & Maintenance",
      "Car Wash",
      "Tyres & Wheels",
      "Auto Electrical Services",
      "Other Vehicle Services",
    ],
  },

  // ============================================================
  // COMMERCIAL PROPERTY
  // ============================================================
  {
    key: "Commercial Property",
    displayShort: "Commercial Property",
    icon: BriefcaseBusiness,
    color: "text-violet-600 bg-violet-50 border-violet-300",
    badgeColor: "bg-violet-100 text-violet-700",
    tagline:
      "Commercial buildings, shops, offices, warehouses, land and business premises",
    subcategories: [
      // Retail
      "Shops for Rent",
      "Shops for Sale",
      "Retail Spaces",
      "Business Premises",

      // Offices
      "Offices for Rent",
      "Offices for Sale",
      "Serviced Offices",
      "Co-working Spaces",

      // Industrial
      "Warehouses",
      "Godowns",
      "Industrial Buildings",
      "Industrial Land",

      // Hospitality
      "Hotels & Lodges",
      "Restaurants",
      "Bars & Entertainment Spaces",

      // Institutions
      "Schools & Institutions",
      "Hospitals & Clinics",

      // Land & buildings
      "Commercial Land for Sale",
      "Commercial Land for Rent",
      "Commercial Buildings for Sale",
      "Commercial Buildings for Rent",

      "Other Commercial Property",
    ],
  },

  // ============================================================
  // OTHER & MISCELLANEOUS
  // ============================================================
  {
    key: "Other & Miscellaneous",
    displayShort: "Other",
    icon: MoreHorizontal,
    color: "text-gray-600 bg-gray-50 border-gray-300",
    badgeColor: "bg-gray-100 text-gray-700",
    tagline:
      "Other products, services, items and things not listed elsewhere",
    subcategories: [
      "Other Products",
      "Other Services",
      "Other Items",
      "Other",
    ],
  },
];

export type CategoryKey = (typeof CATEGORY_DEFS)[number]["key"];

export function getCategoryDef(key: string): CategoryDef | undefined {
  return CATEGORY_DEFS.find((c) => c.key === key);
}

export function getCategoryBadgeColor(key: string): string {
  return (
    getCategoryDef(key)?.badgeColor ??
    "bg-gray-100 text-gray-600"
  );
}
