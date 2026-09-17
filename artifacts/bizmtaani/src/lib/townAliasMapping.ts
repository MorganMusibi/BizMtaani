import { resolveCanonicalLocation, normalize } from './locationHierarchy';

// Single ward towns (1:1 mapping)
export const TOWN_ALIASES = [
  { alias: "ruaka", ward: "Ndenderu", constituency: "Kiambaa", county: "Kiambu" },
  // Nairobi Estates/Areas with non-matching ward names
  { alias: "buruburu", ward: "Harambee", constituency: "Makadara", county: "Nairobi" },
  { alias: "south b", ward: "Nairobi South", constituency: "Starehe", county: "Nairobi" },
  { alias: "madaraka", ward: "Nairobi West", constituency: "Lang'ata", county: "Nairobi" },
  { alias: "donholm", ward: "Upper Savanna", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "nyayo estate", ward: "Embakasi", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "runda", ward: "Karura", constituency: "Westlands", county: "Nairobi" },
  { alias: "muthaiga", ward: "Karura", constituency: "Westlands", county: "Nairobi" },
  { alias: "gigiri", ward: "Karura", constituency: "Westlands", county: "Nairobi" },
  { alias: "hurlingham", ward: "Kilimani", constituency: "Dagoretti North", county: "Nairobi" },
  { alias: "adams arcade", ward: "Kilimani", constituency: "Dagoretti North", county: "Nairobi" },
  { alias: "otiende", ward: "Lang'ata", constituency: "Lang'ata", county: "Nairobi" },
  { alias: "tena", ward: "Harambee", constituency: "Makadara", county: "Nairobi" },
  { alias: "jericho", ward: "Makongeni", constituency: "Makadara", county: "Nairobi" },
  { alias: "fedha", ward: "Kware", constituency: "Embakasi South", county: "Nairobi" },
  { alias: "tassia", ward: "Embakasi", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "satellite", ward: "Riruta", constituency: "Dagoretti South", county: "Nairobi" },
  { alias: "mirema", ward: "Roysambu", constituency: "Roysambu", county: "Nairobi" },
  { alias: "kahawa sukari", ward: "Kahawa", constituency: "Roysambu", county: "Nairobi" },
  { alias: "industrial area", ward: "Viwandani", constituency: "Makadara", county: "Nairobi" },
  { alias: "shauri moyo", ward: "Pumwani", constituency: "Kamukunji", county: "Nairobi" },
  { alias: "greenfields", ward: "Upper Savanna", constituency: "Embakasi East", county: "Nairobi" },
  { alias: "jacaranda", ward: "Kayole Central", constituency: "Embakasi Central", county: "Nairobi" },

  // Mombasa Estates/Areas with non-matching ward names
  { alias: "old town", ward: "Mji wa Kale/Makadara", constituency: "Mvita", county: "Mombasa" },
  { alias: "kizingo", ward: "Ganjoni/Shimanzi", constituency: "Mvita", county: "Mombasa" },
  { alias: "buxton", ward: "Tononoka", constituency: "Mvita", county: "Mombasa" },
  { alias: "saba saba", ward: "Tononoka", constituency: "Mvita", county: "Mombasa" },
  { alias: "shimanzi", ward: "Ganjoni/Shimanzi", constituency: "Mvita", county: "Mombasa" },
  { alias: "makupa", ward: "Tudor", constituency: "Mvita", county: "Mombasa" },
  { alias: "bombolulu", ward: "Ziwa la Ng'ombe", constituency: "Nyali", county: "Mombasa" },
  { alias: "lights", ward: "Mkomani", constituency: "Nyali", county: "Mombasa" },
  { alias: "mamba village", ward: "Mkomani", constituency: "Nyali", county: "Mombasa" },
  { alias: "sokoni", ward: "Kongowea", constituency: "Nyali", county: "Mombasa" },
  { alias: "vescon", ward: "Bamburi", constituency: "Kisauni", county: "Mombasa" },
  { alias: "mwandoni", ward: "Magogoni", constituency: "Kisauni", county: "Mombasa" },
  { alias: "shelly beach", ward: "Timbwani", constituency: "Likoni", county: "Mombasa" },
  { alias: "ferry", ward: "Bofu", constituency: "Likoni", county: "Mombasa" },

  // Kisumu Towns/Estates with non-matching ward names
  { alias: "mamboleo", ward: "Kajulu", constituency: "Kisumu East", county: "Kisumu" },
  { alias: "car wash", ward: "Kajulu", constituency: "Kisumu East", county: "Kisumu" },
  { alias: "patel", ward: "Shaurimoyo Kaloleni", constituency: "Kisumu Central", county: "Kisumu" },
  { alias: "tom mboya estate", ward: "Migosi", constituency: "Kisumu Central", county: "Kisumu" },
  { alias: "dunga", ward: "Market Milimani", constituency: "Kisumu Central", county: "Kisumu" },
  { alias: "milimani kisumu", ward: "Market Milimani", constituency: "Kisumu Central", county: "Kisumu" },
  { alias: "kibos", ward: "Kolwa East", constituency: "Kisumu East", county: "Kisumu" },
  { alias: "rabuor", ward: "Kobura", constituency: "Nyando", county: "Kisumu" },
  { alias: "otonglo", ward: "North West Kisumu", constituency: "Kisumu West", county: "Kisumu" },
  { alias: "rianjunya", ward: "Central Kisumu", constituency: "Kisumu West", county: "Kisumu" },
  { alias: "kiboswa", ward: "South West Kisumu", constituency: "Kisumu West", county: "Kisumu" },

  // ─── Nakuru County — corrected towns/estates ───

// Nakuru Town East
{ alias: "bondeni", ward: "Biashara", constituency: "Nakuru Town East", county: "Nakuru" },       // high
{ alias: "free area", ward: "Biashara", constituency: "Nakuru Town East", county: "Nakuru" },      // med
{ alias: "langalanga", ward: "Flamingo", constituency: "Nakuru Town East", county: "Nakuru" },     // high
{ alias: "shauri yako", ward: "Flamingo", constituency: "Nakuru Town East", county: "Nakuru" },    // med
{ alias: "section 58", ward: "Menengai", constituency: "Nakuru Town East", county: "Nakuru" },     // high
{ alias: "milimani nakuru", ward: "Menengai", constituency: "Nakuru Town East", county: "Nakuru" },// med
{ alias: "naka", ward: "Menengai", constituency: "Nakuru Town East", county: "Nakuru" },           // med
{ alias: "whitehouse", ward: "Menengai", constituency: "Nakuru Town East", county: "Nakuru" },     // med
{ alias: "racecourse", ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },  // high
{ alias: "satellite", ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },   // high
{ alias: "kiamunyi", ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },
{ alias: "ngata", ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },
// Nakuru Town West
{ alias: "mwariki", ward: "Kaptembwo", constituency: "Nakuru Town West", county: "Nakuru" },       // high
{ alias: "london hilton", ward: "London", constituency: "Nakuru Town West", county: "Nakuru" },    // med
{ alias: "kwa rhoda", ward: "Rhonda", constituency: "Nakuru Town West", county: "Nakuru" },        // high

// Naivasha
{ alias: "kihoto", ward: "Naivasha East", constituency: "Naivasha", county: "Nakuru" },            // high
{ alias: "karagita", ward: "Naivasha East", constituency: "Naivasha", county: "Nakuru" },          // high
{ alias: "mirera", ward: "Naivasha East", constituency: "Naivasha", county: "Nakuru" },            // high
{ alias: "karati", ward: "Naivasha East", constituency: "Naivasha", county: "Nakuru" },            // med (border area / Naivasha East)
{ alias: "kedong", ward: "Maiella", constituency: "Naivasha", county: "Nakuru" },                  // med

// Gilgil
{ alias: "kampi somali", ward: "Gilgil", constituency: "Gilgil", county: "Nakuru" },               // high
{ alias: "makaburi", ward: "Gilgil", constituency: "Gilgil", county: "Nakuru" },                   // med
{ alias: "kekopey", ward: "Gilgil", constituency: "Gilgil", county: "Nakuru" },                    // med
{ alias: "kiungururia", ward: "Gilgil", constituency: "Gilgil", county: "Nakuru" },                // med
{ alias: "oljorai", ward: "Mbaruk/Eburu", constituency: "Gilgil", county: "Nakuru" },              // med

// Molo
{ alias: "sachangwan", ward: "Molo", constituency: "Molo", county: "Nakuru" },                     // high
{ alias: "casino", ward: "Molo", constituency: "Molo", county: "Nakuru" },                         // med

// Njoro
{ alias: "jewathu", ward: "Njoro", constituency: "Njoro", county: "Nakuru" },                      // med
{ alias: "juaikali", ward: "Njoro", constituency: "Njoro", county: "Nakuru" },                     // med

// Rongai / Kuresoi South
                  
{ alias: "salgaa", ward: "Visoi", constituency: "Rongai", county: "Nakuru" },                      // med  (Ward fixed from Mosop)
{ alias: "olenguruone", ward: "Kiptagich", constituency: "Kuresoi South", county: "Nakuru" },      // med


  // ─── Kakamega County — towns/estates with non-matching ward names ───

// Lurambi (Kakamega town estates)
{ alias: "Amalemba", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Otiende", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Mudiri", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Joyland", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Shikangania", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Shikhambi", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Shitungu", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Sichirai", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Prison line", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "National housing", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "NHC kakamega", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },
{ alias: "kaburini", ward: "Shirere", constituency: "Lurambi", county: "Kakamega" },

{ alias: "Kefinco", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Koromatangi", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Nyayo tea zone", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Tea zone", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Maraba", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Jaggery", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Murram", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Matende", ward: "Sheywe", constituency: "Lurambi", county: "Kakamega" },

{ alias: "Ikonyero", ward: "Mahiakalo", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Mwiyala", ward: "Mahiakalo", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Bukhungu", ward: "Mahiakalo", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Milimani kakamega", ward: "Mahiakalo", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Ebambwa", ward: "Mahiakalo", constituency: "Lurambi", county: "Kakamega" },
{ alias: "Jamindas", ward: "Mahiakalo", constituency: "Lurambi", county: "Kakamega" },

// Mumias West (Mumias town estates)
{ alias: "Ekama", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Mjini mumias", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Lumino", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Shitukhumi", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Manyatta mumias", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Lukoye", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Nubian mumias", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },
{ alias: "Exe", ward: "Mumias Central", constituency: "Mumias West", county: "Kakamega" },

// Mumias East
{ alias: "buchinga", ward: "East Wanga", constituency: "Mumias East", county: "Kakamega" },

// Other Kakamega towns
{ alias: "bukura", ward: "Butsotso South", constituency: "Lurambi", county: "Kakamega" },
{ alias: "khayega", ward: "Isukha Central", constituency: "Shinyalu", county: "Kakamega" },
{ alias: "malava", ward: "Butali/Chegulo", constituency: "Malava", county: "Kakamega" },
{ alias: "kaunda", ward: "Bunyala West", constituency: "Navakholo", county: "Kakamega" },
{ alias: "mureku", ward: "Bunyala East", constituency: "Navakholo", county: "Kakamega" },
{ alias: "musamba", ward: "Khalaba", constituency: "Matungu", county: "Kakamega" },
{ alias: "ogalo", ward: "Koyonzo", constituency: "Matungu", county: "Kakamega" },
{ alias: "manda", ward: "Manda-Shivanga", constituency: "Malava", county: "Kakamega" },
{ alias: "shikhutse", ward: "West Kabras", constituency: "Malava", county: "Kakamega" },
{ alias: "kimangeti", ward: "Chemuche", constituency: "Malava", county: "Kakamega" },
{ alias: "ikuywa", ward: "Isukha East", constituency: "Shinyalu", county: "Kakamega" },

 // ─── Kiambu County — towns/estates whose names aren't ward names ───

// Thika Town
{ alias: "Makongeni Thika", ward: "Hospital", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Kiandutu", ward: "Hospital", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Section 9", ward: "Thika Township", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Section 22", ward: "Thika Township", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Golf Course Thika", ward: "Thika Township", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Ngoingwa", ward: "Kamenu", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Kenyatta Road", ward: "Kamenu", constituency: "Thika Town", county: "Kiambu" },
{ alias: "Landless", ward: "Kamenu", constituency: "Thika Town", county: "Kiambu" },

// Ruiru
{ alias: "Kamakis", ward: "Biashara", constituency: "Ruiru", county: "Kiambu" },
{ alias: "Kihunguro", ward: "Biashara", constituency: "Ruiru", county: "Kiambu" },
{ alias: "Membley", ward: "Gitothua", constituency: "Ruiru", county: "Kiambu" },
{ alias: "Mugutha", ward: "Gatongora", constituency: "Ruiru", county: "Kiambu" },
{ alias: "Githurai 45", ward: "Kahawa Wendani", constituency: "Ruiru", county: "Kiambu" },

// Juja
{ alias: "Kimbo", ward: "Juja", constituency: "Juja", county: "Kiambu" },
{ alias: "High Point", ward: "Juja", constituency: "Juja", county: "Kiambu" },
{ alias: "Juja Farm", ward: "Murera", constituency: "Juja", county: "Kiambu" },

// Kikuyu
{ alias: "Ondiri", ward: "Kikuyu", constituency: "Kikuyu", county: "Kiambu" },
{ alias: "Kidfarmaco", ward: "Kikuyu", constituency: "Kikuyu", county: "Kiambu" },
{ alias: "Thogoto", ward: "Kikuyu", constituency: "Kikuyu", county: "Kiambu" },
{ alias: "Kerwa", ward: "Kikuyu", constituency: "Kikuyu", county: "Kiambu" },
{ alias: "Gikambura", ward: "Kikuyu", constituency: "Kikuyu", county: "Kiambu" },
{ alias: "Kamangu", ward: "Kikuyu", constituency: "Kikuyu", county: "Kiambu" },

// Kabete
{ alias: "Wangige", ward: "Kabete", constituency: "Kabete", county: "Kiambu" },

// Kiambaa
{ alias: "Banana", ward: "Kihara", constituency: "Kiambaa", county: "Kiambu" },

// Kiambu Town
{ alias: "Kirigiti", ward: "Kiambu Township", constituency: "Kiambu", county: "Kiambu" },

// Limuru
{ alias: "Tigoni", ward: "Ngecha Tigoni", constituency: "Limuru", county: "Kiambu" },
{ alias: "Ngecha", ward: "Ngecha Tigoni", constituency: "Limuru", county: "Kiambu" },
{ alias: "Kamirithu", ward: "Limuru Central", constituency: "Limuru", county: "Kiambu" },

// Gatundu South
{ alias: "Gatundu Town", ward: "Kiganjo", constituency: "Gatundu South", county: "Kiambu" },

// Lari
{ alias: "Lari Town", ward: "Lari/Kirenga", constituency: "Lari", county: "Kiambu" }, 

// Msambweni
{ alias: "Diani", ward: "Ukunda", constituency: "Msambweni", county: "Kwale" },
{ alias: "Diani Beach", ward: "Ukunda", constituency: "Msambweni", county: "Kwale" },
{ alias: "Galu", ward: "Kinondo", constituency: "Msambweni", county: "Kwale" },
{ alias: "Galu Beach", ward: "Kinondo", constituency: "Msambweni", county: "Kwale" },
{ alias: "Msambweni Town", ward: "Ramisi", constituency: "Msambweni", county: "Kwale" },

// Lunga Lunga
{ alias: "Shimoni", ward: "Vanga", constituency: "Lunga Lunga", county: "Kwale" },

// Matuga
{ alias: "Mwaluphamba", ward: "Mkongani", constituency: "Matuga", county: "Kwale" },
{ alias: "Kwale Town", ward: "Tsimba Golini", constituency: "Matuga", county: "Kwale" },


// { alias: "Mackinnon Road", ward: "Mackinnon Road", constituency: "Kinango", county: "Kwale" }, // Option B — if you fix master
{ alias: "Maji ya Chumvi", ward: "Chengoni/Samburu", constituency: "Kinango", county: "Kwale" },
{ alias: "Samburu Kwale", ward: "Chengoni/Samburu", constituency: "Kinango", county: "Kwale" },

  // ─── Kilifi County (003) — towns/estates whose names aren't ward names ───

// Kilifi South
{ alias: "Mtwapa", ward: "Shimo La Tewa", constituency: "Kilifi South", county: "Kilifi" },
{ alias: "Vipingo", ward: "Junju", constituency: "Kilifi South", county: "Kilifi" },
{ alias: "Kikambala", ward: "Mtepeni", constituency: "Kilifi South", county: "Kilifi" },

// Kilifi North
{ alias: "Kilifi Town", ward: "Sokoni", constituency: "Kilifi North", county: "Kilifi" },
{ alias: "Mtondia", ward: "Tezo", constituency: "Kilifi North", county: "Kilifi" },
{ alias: "Mavueni", ward: "Mnarani", constituency: "Kilifi North", county: "Kilifi" },
{ alias: "Takaungu", ward: "Mnarani", constituency: "Kilifi North", county: "Kilifi" },
{ alias: "Bofa", ward: "Kibarani", constituency: "Kilifi North", county: "Kilifi" },

// Malindi
{ alias: "Gede", ward: "Ganda", constituency: "Malindi", county: "Kilifi" },

// Magarini
{ alias: "Mambrui", ward: "Sabaki", constituency: "Magarini", county: "Kilifi" },
{ alias: "Marereni", ward: "Garashi", constituency: "Magarini", county: "Kilifi" },
{ alias: "Ngomeni", ward: "Gongoni", constituency: "Magarini", county: "Kilifi" },

// Kaloleni
{ alias: "Mazeras", ward: "Mariakani", constituency: "Kaloleni", county: "Kilifi" },
 
  // ─── Tana River County (004) — towns/areas whose names aren't ward names ───

// Garsen
{ alias: "Kipini", ward: "Kipini West", constituency: "Garsen", county: "Tana River" },
{ alias: "Ozi", ward: "Kipini West", constituency: "Garsen", county: "Tana River" },

// Galole
{ alias: "Hola", ward: "Chewani", constituency: "Galole", county: "Tana River" },

// Bura
{ alias: "Bura Town", ward: "Chewele", constituency: "Bura", county: "Tana River" },
  
  // ─── Lamu County (005) — towns/areas whose names aren't ward names ───

// Lamu West
{ alias: "Lamu Town", ward: "Mkomani", constituency: "Lamu West", county: "Lamu" },
{ alias: "Lamu Old Town", ward: "Mkomani", constituency: "Lamu West", county: "Lamu" },
{ alias: "Mokowe", ward: "Hindi", constituency: "Lamu West", county: "Lamu" },
{ alias: "Mpeketoni", ward: "Bahari", constituency: "Lamu West", county: "Lamu" },

// Lamu East
{ alias: "Siyu", ward: "Faza", constituency: "Lamu East", county: "Lamu" },
{ alias: "Pate", ward: "Faza", constituency: "Lamu East", county: "Lamu" },
{ alias: "Kizingitini", ward: "Faza", constituency: "Lamu East", county: "Lamu" },
{ alias: "Ndau", ward: "Kiunga", constituency: "Lamu East", county: "Lamu" },

  // ─── Taita-Taveta County (006) — towns/areas whose names aren't ward names ───

// Taveta
{ alias: "Taveta Town", ward: "Mahoo", constituency: "Taveta", county: "Taita-Taveta" },

// Wundanyi
{ alias: "Mgange", ward: "Mwanda/Mgange", constituency: "Wundanyi", county: "Taita-Taveta" },
{ alias: "Wumingu", ward: "Wumingu/Kishushe", constituency: "Wundanyi", county: "Taita-Taveta" },
{ alias: "Kishushe", ward: "Wumingu/Kishushe", constituency: "Wundanyi", county: "Taita-Taveta" },

// Mwatate
{ alias: "Maktau", ward: "Mwatate", constituency: "Mwatate", county: "Taita-Taveta" },
{ alias: "Bura Mission", ward: "Bura", constituency: "Mwatate", county: "Taita-Taveta" },

// Voi
{ alias: "Voi Town", ward: "Kaloleni", constituency: "Voi", county: "Taita-Taveta" },
{ alias: "Ikanga", ward: "Kaloleni", constituency: "Voi", county: "Taita-Taveta" },
{ alias: "Maungu", ward: "Marungu", constituency: "Voi", county: "Taita-Taveta" },
{ alias: "Ndii", ward: "Ngolia", constituency: "Voi", county: "Taita-Taveta" },
{ alias: "Mwakingali", ward: "Kaloleni", constituency: "Voi", county: "Taita-Taveta" },

  // ─── Meru County (012) — towns/estates whose names aren't ward names ───

// Imenti North
{ alias: "Meru Town", ward: "Municipality", constituency: "Imenti North", county: "Meru" },
{ alias: "Kaaga", ward: "Ntima East", constituency: "Imenti North", county: "Meru" },
{ alias: "Kiorone", ward: "Ntima West", constituency: "Imenti North", county: "Meru" },
{ alias: "Gitembene", ward: "Ntima West", constituency: "Imenti North", county: "Meru" },

// Imenti South
{ alias: "Nkubu", ward: "Nkuene", constituency: "Imenti South", county: "Meru" },
{ alias: "Kanyekine", ward: "Abogeta West", constituency: "Imenti South", county: "Meru" },

// Buuri
{ alias: "Subuiga", ward: "Kiirua/Naari", constituency: "Buuri", county: "Meru" },

// Tigania West
{ alias: "Urru", ward: "Akithi", constituency: "Tigania West", county: "Meru" },

// Igembe South
{ alias: "Maua Town", ward: "Maua", constituency: "Igembe South", county: "Meru" },

// Central Imenti
{ alias: "Gaitu", ward: "Mwanganthia", constituency: "Central Imenti", county: "Meru" },
{ alias: "Kariene", ward: "Abothuguchi Central", constituency: "Central Imenti", county: "Meru" },

  // ─── Tharaka-Nithi County (013) — towns/estates whose names aren't ward names ───

// Chuka/Igambang'ombe
{ alias: "Chuka Town", ward: "Karingani", constituency: "Chuka/Igambang'ombe", county: "Tharaka-Nithi" },
{ alias: "Chuka University", ward: "Karingani", constituency: "Chuka/Igambang'ombe", county: "Tharaka-Nithi" },
{ alias: "Ndagani", ward: "Karingani", constituency: "Chuka/Igambang'ombe", county: "Tharaka-Nithi" },
{ alias: "Rubate", ward: "Igambang'ombe", constituency: "Chuka/Igambang'ombe", county: "Tharaka-Nithi" },
{ alias: "Kibugua", ward: "Magumoni", constituency: "Chuka/Igambang'ombe", county: "Tharaka-Nithi" },

// Maara
{ alias: "Kabeche", ward: "Mwimbi", constituency: "Maara", county: "Tharaka-Nithi" },

// Tharaka
{ alias: "Kathwana", ward: "Nkondi", constituency: "Tharaka", county: "Tharaka-Nithi" },

  // ─── Embu County (014) — towns/estates whose names aren't ward names ───

// Manyatta (Embu Town & surroundings)
{ alias: "Embu Town", ward: "Kirimari", constituency: "Manyatta", county: "Embu" },
{ alias: "Kikuyu Estate", ward: "Kirimari", constituency: "Manyatta", county: "Embu" },
{ alias: "Majengo Embu", ward: "Kirimari", constituency: "Manyatta", county: "Embu" },
{ alias: "Koinange Estate", ward: "Kirimari", constituency: "Manyatta", county: "Embu" },
{ alias: "Kangaru", ward: "Nginda", constituency: "Manyatta", county: "Embu" },
{ alias: "Itabua", ward: "Nginda", constituency: "Manyatta", county: "Embu" },
{ alias: "Mucha", ward: "Ruguru/Ngandori", constituency: "Manyatta", county: "Embu" },
{ alias: "Kianjokoma", ward: "Ruguru/Ngandori", constituency: "Manyatta", county: "Embu" },
{ alias: "Kibugu", ward: "Ruguru/Ngandori", constituency: "Manyatta", county: "Embu" },
{ alias: "Manyatta Market", ward: "Gaturi South", constituency: "Manyatta", county: "Embu" },

// Runyenjes
{ alias: "Runyenjes Town", ward: "Central Ward", constituency: "Runyenjes", county: "Embu" },
{ alias: "Runyenjes Market", ward: "Central Ward", constituency: "Runyenjes", county: "Embu" },
{ alias: "Karurumo", ward: "Kyeni North", constituency: "Runyenjes", county: "Embu" },
{ alias: "Macha", ward: "Kyeni South", constituency: "Runyenjes", county: "Embu" },

// Mbeere South
{ alias: "Gachoka", ward: "Mbeti South", constituency: "Mbeere South", county: "Embu" },
{ alias: "Kiritiri", ward: "Mbeti South", constituency: "Mbeere South", county: "Embu" },
{ alias: "Karaba", ward: "Mwea", constituency: "Mbeere South", county: "Embu" },
{ alias: "Kamburu", ward: "Mwea", constituency: "Mbeere South", county: "Embu" },

// Mbeere North
{ alias: "Siakago", ward: "Nthawa", constituency: "Mbeere North", county: "Embu" },
{ alias: "Ishara", ward: "Evurore", constituency: "Mbeere North", county: "Embu" },
  
  // ─── Kitui County (015) — towns/estates whose names aren't ward names ───

// Kitui Central
{ alias: "Kalundu Market", ward: "Township", constituency: "Kitui Central", county: "Kitui" },

// Kitui Rural
{ alias: "Kisasi Market", ward: "Kisasi", constituency: "Kitui Rural", county: "Kitui" },

// Kitui West
{ alias: "Kabati Market", ward: "Mutonguni", constituency: "Kitui West", county: "Kitui" },  // verify ward

// Mwingi Central
{ alias: "Mwingi Town", ward: "Mwingi Central", constituency: "Mwingi Central", county: "Kitui" },
  
  // ─── Machakos County (016) — towns/estates whose names aren't ward names ───

// Machakos Town
{ alias: "Machakos Town", ward: "Machakos Central", constituency: "Machakos Town", county: "Machakos" },
{ alias: "Konza", ward: "Kalama", constituency: "Machakos Town", county: "Machakos" },
{ alias: "Mumbuni", ward: "Mumbuni North", constituency: "Machakos Town", county: "Machakos" },
{ alias: "Kiima Kimwe", ward: "Muvuti/Kiima-Kimwe", constituency: "Machakos Town", county: "Machakos" },

// Mavoko
{ alias: "Mlolongo", ward: "Syokimau/Mulolongo", constituency: "Mavoko", county: "Machakos" },
{ alias: "Katani", ward: "Muthwani", constituency: "Mavoko", county: "Machakos" },

// Kangundo
{ alias: "Kangundo Town", ward: "Kangundo Central", constituency: "Kangundo", county: "Machakos" },

// Kathiani
{ alias: "Kathiani Town", ward: "Kathiani Central", constituency: "Kathiani", county: "Machakos" },

// Matungulu
{ alias: "Kenol", ward: "Matungulu West", constituency: "Matungulu", county: "Machakos" },
  // Add more single-ward towns here
  // { alias: "kayole", ward: "Kayole North", constituency: "Embakasi North", county: "Nairobi" },
] as const;

// Multi-ward towns (1:many mapping)
export const MULTI_WARD_TOWNS = {
  "kitale": [
    { ward: "Tuwan", constituency: "Saboti", county: "Trans-Nzoia" },
    { ward: "Kinyoro", constituency: "Saboti", county: "Trans-Nzoia" },
    { ward: "Matisi", constituency: "Saboti", county: "Trans-Nzoia" },
    { ward: "Hospital", constituency: "Kiminini", county: "Trans-Nzoia" },
    { ward: "Sirende", constituency: "Kiminini", county: "Trans-Nzoia" },
    { ward: "Waitaluk", constituency: "Kiminini", county: "Trans-Nzoia" },
    { ward: "Bidii", constituency: "Kwanza", county: "Trans-Nzoia" },
    { ward: "Kapomboi", constituency: "Kwanza", county: "Trans-Nzoia" },
  ],
  "lavington": [
    { ward: "Kileleshwa", constituency: "Dagoretti North", county: "Nairobi" },
    { ward: "Kitisuru", constituency: "Westlands", county: "Nairobi" },
  ],
  "loresho": [
    { ward: "Mountain View", constituency: "Westlands", county: "Nairobi" },
    { ward: "Kitisuru", constituency: "Westlands", county: "Nairobi" },
  ],
  // Optional: Add to MULTI_WARD_TOWNS if you handle sprawling Kisumu hubs with multi-ward coverage:

  "maseno": [
    { ward: "North West Kisumu", constituency: "Kisumu West", county: "Kisumu" },
    { ward: "West Seme", constituency: "Seme", county: "Kisumu" },
  ],

  "Thika": [
  { ward: "Thika Township", constituency: "Thika Town", county: "Kiambu" },
  { ward: "Hospital", constituency: "Thika Town", county: "Kiambu" },
  { ward: "Kamenu", constituency: "Thika Town", county: "Kiambu" },
],
"Ruiru": [
  { ward: "Biashara", constituency: "Ruiru", county: "Kiambu" },
  { ward: "Gitothua", constituency: "Ruiru", county: "Kiambu" },
  { ward: "Kahawa Wendani", constituency: "Ruiru", county: "Kiambu" },
],

  "Diani Municipality": [
  { ward: "Ukunda", constituency: "Msambweni", county: "Kwale" },
  { ward: "Gombato Bongwe", constituency: "Msambweni", county: "Kwale" },
],

  "Voi": [
  { ward: "Kaloleni", constituency: "Voi", county: "Taita-Taveta" },
  { ward: "Sagala", constituency: "Voi", county: "Taita-Taveta" },
  { ward: "Mbololo", constituency: "Voi", county: "Taita-Taveta" },
],

  "Garissa": [
  { ward: "Township", constituency: "Garissa Township", county: "Garissa" },
  { ward: "Waberi", constituency: "Garissa Township", county: "Garissa" },
  { ward: "Iftin", constituency: "Garissa Township", county: "Garissa" },
  { ward: "Galbet", constituency: "Garissa Township", county: "Garissa" },
],

  "Machakos Town": [
  { ward: "Machakos Central", constituency: "Machakos Town", county: "Machakos" },
  { ward: "Mumbuni North", constituency: "Machakos Town", county: "Machakos" },
  { ward: "Mua", constituency: "Machakos Town", county: "Machakos" },
  { ward: "Kola", constituency: "Machakos Town", county: "Machakos" },
],
  // Add more multi-ward towns here
  // "nakuru": [
  //   { ward: "Nakuru East", constituency: "Nakuru Town East", county: "Nakuru" },
  //   { ward: "Nakuru West", constituency: "Nakuru Town West", county: "Nakuru" },
  // ],
} as const;

export type TownAlias = keyof typeof MULTI_WARD_TOWNS;

// All multi-ward town keys, typed. Used instead of direct bracket
// access (MULTI_WARD_TOWNS[x as TownAlias]) now that lookups go
// through normalize() rather than an exact object-key match.
const MULTI_WARD_TOWN_KEYS = Object.keys(MULTI_WARD_TOWNS) as TownAlias[];

// Shape consumed by AreaPickerSheet / location.ts. NOTE: constituency/
// county here (not constituencyName/countyName) — AreaPickerSheet maps
// loc.constituency -> constituencyName and loc.county -> countyName
// when it calls onSearchSelect, so this shape must match.
export interface ResolvedLocation {
  wardName: string;
  constituency: string;
  county: string;
  displayName: string;
  /**
   * The alias text as searched (e.g. "Ruaka"), title-cased — set only
   * when this result came from the alias table. Callers that want to
   * show the town name the user actually typed, instead of the
   * canonical ward it maps to, should prefer this over displayName.
   */
  label?: string;
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve an alias entry against MasterHierarchy.json — the alias
 * table is only ever a pointer at a ward; MasterHierarchy is the
 * source of truth for whether that ward exists and what its
 * canonical names are.
 *
 * resolveCanonicalLocation returns { wardName, constituencyName,
 * countyName }; that's mapped here to the { wardName, constituency,
 * county, displayName } shape above.
 *
 * If validation fails, that means an alias entry has a typo or
 * references a ward/constituency/county combination that isn't in
 * the hierarchy — a bug in the alias table, not a "not added yet"
 * situation. This does NOT fabricate a result: it warns (so the bad
 * entry surfaces during development) and returns null, so the
 * caller treats it the same as any other unresolved search term.
 */
async function resolveAndValidate(
  alias: string,
  ward: string,
  constituency: string,
  county: string
): Promise<ResolvedLocation | null> {
  const canonical = await resolveCanonicalLocation(ward, constituency, county);
  if (!canonical) {
    console.warn(
      `[townAliasMapping] "${alias}" -> ward="${ward}", constituency="${constituency}", county="${county}" ` +
      `did not match MasterHierarchy.json. Check this alias entry for a typo.`
    );
    return null;
  }

  return {
    wardName: canonical.wardName,
    constituency: canonical.constituencyName,
    county: canonical.countyName,
    displayName: `${canonical.wardName}, ${canonical.constituencyName}`,
    label: toTitleCase(alias),
  };
}

// Check if a search term is a known town — exact match, using the

// Check if a search term is a known town — exact match, using the
// same normalize() as locationHierarchy.ts (strips spaces, apostrophes,
// hyphens, slashes), so "buru buru" and "buruburu" resolve identically,
// same as "Trans Nzoia"/"Trans-Nzoia" or "babadogo"/"Baba Dogo" do
// against MasterHierarchy.
export async function resolveWardFromAlias(searchTerm: string): Promise<ResolvedLocation | null> {
  const normalizedQuery = normalize(searchTerm);
  if (!normalizedQuery) return null;

  // 1. Check single ward match first
  const singleMatch = TOWN_ALIASES.find(a => normalize(a.alias) === normalizedQuery);
  if (singleMatch) {
    return await resolveAndValidate(
      singleMatch.alias,
      singleMatch.ward,
      singleMatch.constituency,
      singleMatch.county
    );
  }

  // 2. Check multi-ward town - return first (central) ward as default
  const townKey = MULTI_WARD_TOWN_KEYS.find(k => normalize(k) === normalizedQuery);
  if (townKey) {
    const primary = MULTI_WARD_TOWNS[townKey][0]; // Hospital ward for Kitale
    return await resolveAndValidate(
      townKey,
      primary.ward,
      primary.constituency,
      primary.county
    );
  }

  return null;
}

// Get ALL wards for a multi-ward town (for the picker UI) — exact
// match via normalize(), same as resolveWardFromAlias above.
export async function getAllWardsForTown(searchTerm: string): Promise<ResolvedLocation[] | null> {
  const normalizedQuery = normalize(searchTerm);
  if (!normalizedQuery) return null;

  const townKey = MULTI_WARD_TOWN_KEYS.find(k => normalize(k) === normalizedQuery);
  if (!townKey) return null;

  const results = await Promise.all(
    MULTI_WARD_TOWNS[townKey].map(({ ward, constituency, county }) =>
      resolveAndValidate(townKey, ward, constituency, county)
    )
  );

  // Drop entries that failed validation (typo'd alias data) rather
  // than showing an unverified location in the picker.
  return results.filter((r): r is ResolvedLocation => r !== null);
}

// Check if a search term is a multi-ward town — exact match via normalize().
export function isMultiWardTown(searchTerm: string): boolean {
  const normalizedQuery = normalize(searchTerm);
  if (!normalizedQuery) return false;
  return MULTI_WARD_TOWN_KEYS.some(k => normalize(k) === normalizedQuery);
}

export interface TownAliasMatch {
  /** The alias text as stored, for display (e.g. "buruburu", "kitale") */
  alias: string;
  isMultiWard: boolean;
}

/**
 * Search town aliases by a typed, partial name — for search-as-you-type
 * autocomplete in the area picker. Same substring + normalize()
 * approach as searchWardsByName/searchConstituenciesByName in
 * locationHierarchy.ts, so typing "buru" surfaces "buruburu" as a
 * suggestion before the full name is typed, and "trans" would surface
 * "kitale" (matched loosely) the same way "babadogo" partial-matches
 * "Baba Dogo" in the ward search.
 *
 * Returns alias names only — callers resolve each one individually
 * with resolveWardFromAlias/getAllWardsForTown once the person picks
 * a suggestion, same as the ward-search flow resolves a picked ward.
 */
export function searchTownAliases(queryText: string, limit = 8): TownAliasMatch[] {
  const trimmed = queryText.trim();
  if (!trimmed) return [];
  const normalizedQuery = normalize(trimmed);

  const singleMatches: TownAliasMatch[] = TOWN_ALIASES
    .filter(a => normalize(a.alias).includes(normalizedQuery))
    .map(a => ({ alias: a.alias, isMultiWard: false }));

  const multiMatches: TownAliasMatch[] = MULTI_WARD_TOWN_KEYS
    .filter(k => normalize(k).includes(normalizedQuery))
    .map(k => ({ alias: k, isMultiWard: true }));

  return [...singleMatches, ...multiMatches].slice(0, limit);
}
