/**
 * stamp_presets.js — bundled stamp placements + pattern presets for the
 * Calamba City Hall wayfinding app.
 *
 * Loaded automatically on first app start or when STAMP_PRESETS_VERSION
 * differs from what's cached in localStorage. Bundled placements OVERRIDE
 * matching IDs in localStorage; any locally-placed stamps without a
 * matching ID in the bundle are preserved (the merge logic lives in
 * applyStampPresets() in data.js).
 *
 * AUTO-EXPORTED on 2026-06-12T15:40:04+00:00.
 * Do not hand-edit — use Floors ▾ → Export/Deploy Stamps instead.
 */

"use strict";

// Bump this whenever the bundled stamp data changes. The app's
// applyStampPresets() runs when this differs from the cached version
// in localStorage.
const STAMP_PRESETS_VERSION = 1;

/**
 * Bundled stamp placements — each is { id, name, row, col, size, floor, source: 'bundled' }.
 */
const STAMP_PLACEMENTS_BUNDLED = [
  {
    "id": "mq8wlr4y8xy",
    "name": "DTI",
    "row": 68,
    "col": 50,
    "size": 5,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xlv1a66l",
    "name": "GF 01 CATSDD",
    "row": 63,
    "col": 16,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xmwyyl3b",
    "name": "GF 02a CCRO",
    "row": 56,
    "col": 9,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xnahuf2d",
    "name": "GF 02b CCRO",
    "row": 52,
    "col": 5,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xv8bgdyz",
    "name": "GF 05a CTMO",
    "row": 19,
    "col": 7,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xvl4j7do",
    "name": "GF 05b CTMO",
    "row": 9,
    "col": 17,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xybecmi8",
    "name": "GF 06",
    "row": 2,
    "col": 26,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xyi56399",
    "name": "GF 07",
    "row": 2,
    "col": 28,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xytrzdnl",
    "name": "CR",
    "row": 2,
    "col": 46,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8xz1hgcsh",
    "name": "CR",
    "row": 47,
    "col": 2,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y0jkxtz8",
    "name": "GF 09b CAO",
    "row": 8,
    "col": 55,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y1ipnhkg",
    "name": "GF 09a CAO",
    "row": 17,
    "col": 64,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y1p4gjna",
    "name": "Citizen Charter",
    "row": 21,
    "col": 68,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y42zsq9v",
    "name": "MOPAC",
    "row": 31,
    "col": 70,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y441a06r",
    "name": "MOPAC",
    "row": 31,
    "col": 64,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y452egqn",
    "name": "MOPAC",
    "row": 41,
    "col": 70,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y464akng",
    "name": "MOPAC",
    "row": 41,
    "col": 64,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y4hmx5n9",
    "name": "CR",
    "row": 47,
    "col": 71,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y5vwgqny",
    "name": "GF 12a BPATFO",
    "row": 53,
    "col": 66,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y6g97n6k",
    "name": "GF 12b BPATFO",
    "row": 56,
    "col": 63,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq8y7coq9hi",
    "name": "GF 13a and 13b M-PH",
    "row": 61,
    "col": 58,
    "size": 3,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq9n059cefc",
    "name": "Ground Floor",
    "row": 36,
    "col": 36,
    "size": 5,
    "floor": 0,
    "source": "bundled"
  },
  {
    "id": "mq9nazedozr",
    "name": "Lower Ground Floor",
    "row": 37,
    "col": 37,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nfk8urws",
    "name": "LG 01 HASD",
    "row": 70,
    "col": 26,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9ngg5oeim",
    "name": "LG 02a LandBank",
    "row": 63,
    "col": 16,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9ngkr8d1w",
    "name": "LG 02b LandBank",
    "row": 57,
    "col": 10,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9ngvgqgas",
    "name": "Chapel",
    "row": 53,
    "col": 6,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nh52i8wd",
    "name": "CR",
    "row": 51,
    "col": 4,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nit715mk",
    "name": "LG 04 CHSD",
    "row": 43,
    "col": 2,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nk0wl465",
    "name": "SNMSCGOC",
    "row": 31,
    "col": 2,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nl8dvelk",
    "name": "LG 08 CTMO",
    "row": 17,
    "col": 8,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nmjrdldr",
    "name": "LG 09",
    "row": 10,
    "col": 15,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nmunmtls",
    "name": "Local Recruitment",
    "row": 14,
    "col": 19,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nnlkqa2q",
    "name": "LG 10a CSSD",
    "row": 2,
    "col": 28,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nq0c07oq",
    "name": "LG 10b CSSD",
    "row": 2,
    "col": 45,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nq8x6sxq",
    "name": "LG 11 CPU",
    "row": 11,
    "col": 29,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nr79iqqu",
    "name": "DOC Cha Hernandez",
    "row": 9,
    "col": 57,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nrhq6p7y",
    "name": "Kasalang Bayan",
    "row": 13,
    "col": 53,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9ns6iidfn",
    "name": "LG 16 CVASMD",
    "row": 15,
    "col": 63,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nsktdhzb",
    "name": "LG 17 CASD",
    "row": 19,
    "col": 67,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9ntk8d2nw",
    "name": "PWD Office",
    "row": 30,
    "col": 71,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nuh8o6v6",
    "name": "LG 20 OOTPP",
    "row": 38,
    "col": 71,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nvurzu78",
    "name": "LG 23 PPOPOL",
    "row": 54,
    "col": 66,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nwfnxclu",
    "name": "LG 24 CALDD",
    "row": 66,
    "col": 54,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nwxxn188",
    "name": "LG 25 BAC",
    "row": 70,
    "col": 48,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nxcct1nm",
    "name": "LG 19 COA",
    "row": 70,
    "col": 42,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9nxueuf9l",
    "name": "HSD Services",
    "row": 70,
    "col": 29,
    "size": 3,
    "floor": 1,
    "source": "bundled"
  },
  {
    "id": "mq9o7s14der",
    "name": "2F 01b CAICO",
    "row": 63,
    "col": 16,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o7wy2fb9",
    "name": "2F 01a CAICO",
    "row": 57,
    "col": 10,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o8aumd9u",
    "name": "2F 02 CLSO",
    "row": 55,
    "col": 8,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o8ll9lsd",
    "name": "2F 03 CHRMO",
    "row": 53,
    "col": 6,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o9cznqgi",
    "name": "CR",
    "row": 47,
    "col": 2,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o9ik74i3",
    "name": "COA",
    "row": 35,
    "col": 2,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o9o984c2",
    "name": "COA",
    "row": 35,
    "col": 2,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9o9xn8kj6",
    "name": "2nd Floor",
    "row": 37,
    "col": 37,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9ocjl5aux",
    "name": "2F 07 DILG",
    "row": 19,
    "col": 6,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9odk3u15b",
    "name": "Sangguniang Panglungsod Record",
    "row": 2,
    "col": 37,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9oec9krg2",
    "name": "2F 10a CENRD",
    "row": 6,
    "col": 21,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9og37rtbi",
    "name": "Office City Mayor Office-Sectoral Affair",
    "row": 9,
    "col": 24,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9ogrn7se0",
    "name": "2F 11",
    "row": 2,
    "col": 28,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9ohbg1fsc",
    "name": "CR",
    "row": 2,
    "col": 48,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9oi720q96",
    "name": "2F 13 OOTBO",
    "row": 8,
    "col": 56,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9oio5j5mm",
    "name": "2F 14 CEIDD",
    "row": 18,
    "col": 66,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9okvbj2z7",
    "name": "2F 16 MOIAS",
    "row": 34,
    "col": 71,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9ol4wr0by",
    "name": "CPMO",
    "row": 36,
    "col": 71,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9olhq8yzu",
    "name": "CR",
    "row": 47,
    "col": 71,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9om2s75si",
    "name": "2F 19a CPDO",
    "row": 54,
    "col": 66,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9omelhdhm",
    "name": "2F 19b CPDO",
    "row": 60,
    "col": 60,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9ompqbqst",
    "name": "2F 20 CBMO",
    "row": 64,
    "col": 56,
    "size": 3,
    "floor": 2,
    "source": "bundled"
  },
  {
    "id": "mq9oxr5czwt",
    "name": "CR",
    "row": 48,
    "col": 2,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9oyl1po8x",
    "name": "CC Lazaro",
    "row": 64,
    "col": 17,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9oytgrw7m",
    "name": "CC Soliman",
    "row": 61,
    "col": 14,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9oyyu3pdh",
    "name": "CC Morales",
    "row": 58,
    "col": 11,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9oz3szqgn",
    "name": "CC Dimapilis",
    "row": 55,
    "col": 8,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p0cp2rcs",
    "name": "CC Silva",
    "row": 52,
    "col": 5,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p0lars6n",
    "name": "ABC Pres",
    "row": 51,
    "col": 4,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p2piy1j0",
    "name": "CC Aldabe-Cortez",
    "row": 37,
    "col": 2,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p3afewk0",
    "name": "SP Secretariat",
    "row": 6,
    "col": 19,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p3i19y5s",
    "name": "CR",
    "row": 2,
    "col": 25,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p4ms0inj",
    "name": "CC Oruga",
    "row": 19,
    "col": 6,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p4v7auuf",
    "name": "CC Catindig",
    "row": 16,
    "col": 9,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p54p83m3",
    "name": "Vice Mayor",
    "row": 11,
    "col": 14,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p60m2myq",
    "name": "3F 17d Session Hall",
    "row": 2,
    "col": 30,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p67n5ssg",
    "name": "3F 17a Session Hall",
    "row": 2,
    "col": 43,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p75316gf",
    "name": "Office of City Mayor",
    "row": 7,
    "col": 55,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p7lse17b",
    "name": "3F 19 MOBAS",
    "row": 11,
    "col": 59,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p81yg0k9",
    "name": "3F 20 OEA",
    "row": 14,
    "col": 62,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p8c7t298",
    "name": "3F 21",
    "row": 16,
    "col": 64,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p8g56il8",
    "name": "3F 22",
    "row": 18,
    "col": 66,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p8jhp1d8",
    "name": "3F 23",
    "row": 20,
    "col": 68,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p8luzrol",
    "name": "3F 24",
    "row": 21,
    "col": 69,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9p9o6p87v",
    "name": "Office of City Admin",
    "row": 28,
    "col": 71,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9paa4zubd",
    "name": "Mayor's Clearance",
    "row": 53,
    "col": 67,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9paq98jnv",
    "name": "3F 29 Administration Office",
    "row": 55,
    "col": 65,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9pb43tt0s",
    "name": "CC Mangiat",
    "row": 57,
    "col": 63,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9pbcujbzx",
    "name": "CC Lajara",
    "row": 60,
    "col": 60,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9pbkndhu8",
    "name": "CC Cabrera",
    "row": 63,
    "col": 57,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9pbq8he2j",
    "name": "CC Silva",
    "row": 65,
    "col": 55,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  },
  {
    "id": "mq9pcu5omoa",
    "name": "3rd Floor",
    "row": 37,
    "col": 37,
    "size": 3,
    "floor": 3,
    "source": "bundled"
  }
];

/**
 * Bundled stamp pattern presets — each is { id, name, size, pattern: cellType[][] }.
 */
const STAMP_PRESETS_BUNDLED = [
  {
    "id": "mmp1qb27qsq",
    "name": "cr",
    "size": 5,
    "pattern": [
      [
        false,
        true,
        false,
        true,
        false
      ],
      [
        true,
        false,
        false,
        true,
        false
      ],
      [
        true,
        false,
        false,
        true,
        true
      ],
      [
        false,
        true,
        true,
        false,
        false
      ],
      [
        false,
        false,
        true,
        false,
        false
      ]
    ]
  },
  {
    "id": "mmpzjy33bmm",
    "name": "room 1",
    "size": 6,
    "pattern": [
      [
        "wall",
        "wall",
        "wall",
        "wall",
        "wall",
        "wall"
      ],
      [
        "wall",
        "open",
        "open",
        "open",
        "open",
        "wall"
      ],
      [
        "wall",
        "open",
        "open",
        "open",
        "open",
        "wall"
      ],
      [
        "wall",
        "open",
        "open",
        "open",
        "open",
        "wall"
      ],
      [
        "wall",
        "open",
        "open",
        "open",
        "open",
        "wall"
      ],
      [
        "wall",
        "wall",
        "door",
        "wall",
        "wall",
        "wall"
      ]
    ]
  },
  {
    "id": "mmpzlt1qexx",
    "name": "room 2",
    "size": 6,
    "pattern": [
      [
        "wall",
        "wall",
        "wall",
        "wall",
        "wall",
        "wall"
      ],
      [
        "wall",
        "open",
        "open",
        "open",
        "open",
        "wall"
      ],
      [
        "wall",
        "open",
        "open",
        "open",
        "open",
        "wall"
      ],
      [
        "open",
        "wall",
        "wall",
        "door",
        "wall",
        "open"
      ],
      [
        "open",
        "open",
        "open",
        "open",
        "open",
        "open"
      ],
      [
        "open",
        "open",
        "open",
        "open",
        "open",
        "open"
      ]
    ]
  }
];

/**
 * Apply the bundled stamp data to the live STAMP_PLACEMENTS / STAMP_PRESETS
 * arrays. Strategy:
 *   - REPLACE: bundled placements override any with matching IDs in localStorage.
 *   - PRESERVE: placements without a matching ID in the bundle (i.e. locally
 *               placed on this device) survive untouched.
 * This way an admin can publish a canonical set, while individual users can
 * still add personal annotations that don't get clobbered on the next deploy.
 *
 * Pattern presets are replaced wholesale (they're shared templates, not per-user).
 */
function applyStampPresets() {
  if (typeof STAMP_PLACEMENTS !== 'undefined') {
    const bundledIds = new Set(STAMP_PLACEMENTS_BUNDLED.map(p => p.id));
    const locallyOnly = STAMP_PLACEMENTS.filter(p => !bundledIds.has(p.id) && p.source !== 'bundled');
    STAMP_PLACEMENTS.length = 0;
    STAMP_PLACEMENTS.push(
      ...STAMP_PLACEMENTS_BUNDLED.map(p => Object.assign({}, p)),
      ...locallyOnly,
    );
    if (typeof saveStampPlacements === 'function') saveStampPlacements();
  }
  if (typeof STAMP_PRESETS !== 'undefined') {
    STAMP_PRESETS.length = 0;
    STAMP_PRESETS.push(
      ...STAMP_PRESETS_BUNDLED.map(p => Object.assign({}, p, {
        pattern: p.pattern.map(row => row.slice()),
      })),
    );
    if (typeof _saveStampPresets === 'function') _saveStampPresets();
  }
}
