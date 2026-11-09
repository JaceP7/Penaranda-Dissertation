/**
 * lib/scope_guard.js - questions the assistant should not try to answer from
 * the Citizen's Charter (Jace, 2026-11-09: "limit the responses to only
 * directing to services. comfort rooms, canteens, etc. are out of scope. have
 * a short explanation then point to public help desks").
 *
 * On 2026-11-09 these went to the search anyway: "canteen" was offered a list
 * of services, a question for the exit was sent to the City College exit
 * clearance, and questions about the mayor, the CR,
 * "cafeteria", "LandBank" and "DPWH" found nothing.
 *
 * A facility or agency word only counts when the question is ABOUT it: the
 * whole question is that word plus where-is and filler words ("saan ang CR",
 * "where is the DPWH office", "canteen"). Many real services merely mention
 * them ("photocopy of valid ID" is in 44 requirement lists, a COMELEC voter's
 * certification in about 45, and "Exit Clearance" is a City College service),
 * and those must still reach the search. PhilHealth, BIR and Pag-IBIG appear in
 * City Hall service names, so they are not on the agency list at all.
 */
'use strict';

const FILLER = new Set(`
  saan nasaan nasan asan san saang nasa nandito dito diyan doon andito
  where wheres is are the a an to of in on at for my me i we can could find get go
  how do does there here any nearest closest near malapit pinakamalapit
  ang ng sa yung ung po ba ho na pa lang naman meron mayroon may pwede puwede
  magpa mag pumunta punta papunta pupunta makapunta makita hanap hanapin
  city hall cityhall munisipyo building gusali office opisina area place lugar
  please pls ask tanong question located location way
`.trim().split(/\s+/));

// One topic per set. A question is that topic when every content word is in it.
const TOPICS = {
  exit: new Set(['exit', 'exits', 'labasan', 'palabas', 'lumabas', 'out']),
  amenity: new Set(`
    cr crs comfort room rooms restroom restrooms toilet toilets banyo palikuran cubicle cubeta
    canteen canteens cafeteria kantina karinderya kainan makakainan food court foodcourt
    atm atms bank banks bangko landbank parking paradahan park
    xerox photocopy photocopier photocopying print printing printer magpaprint magpa-xerox
    wifi internet chapel prayer kapilya smoking water inumin drinking fountain elevator lift
    charging charger saksakan lounge waiting
  `.trim().split(/\s+/)),
  agency: new Set(`
    dpwh lto sss nbi passport dfa gsis
  `.trim().split(/\s+/)),
};
// Words that must appear for the topic to count (a bare "id" or "room" is not one).
const ANCHORS = {
  exit: new Set(['exit', 'exits', 'labasan', 'palabas', 'lumabas']),
  amenity: new Set([...TOPICS.amenity].filter((w) => !['room', 'rooms', 'food', 'court', 'park',
    'water', 'waiting', 'print', 'printing', 'printer', 'lift', 'prayer'].includes(w))
    .concat(['comfort room'])),
  // COMELEC is not here: it has an office in the building (LG 19), found by
  // the office finder.
  agency: new Set(['dpwh', 'lto', 'sss', 'nbi', 'passport', 'dfa', 'gsis']),
};

const PERSON = /^(sino|who)\b.*\b(mayor|vice mayor|head|hepe|chief|councilors?|konsehal|officer|director|administrator|secretary|in charge)\b|\b(name of|pangalan ng)\b.*\b(mayor|head|chief|officer)\b/i;
const META = /\b(this|the) (ai|chat|chatbot|bot|assistant|app)\b|\bwhat can you\b|\bwhat do you do\b|\bano(ng)? (ang )?(kaya|kayang|maitutulong|matutulong)\b|\bhow (do i|to) use (this|you)\b/i;
const SMALLTALK = /^(hi|hello|hey|helo|good (morning|afternoon|evening)|magandang (umaga|tanghali|hapon|gabi)|thanks?|thank you|thank u|ty|salamat|maraming salamat|ok|okay|sige)( po| ho)?[\s!.?]*$/i;
const THANKS = /thank|salamat|^ty\b/i;

const LABELS = {
  cr: 'comfort rooms', crs: 'comfort rooms', comfort: 'comfort rooms', restroom: 'comfort rooms', restrooms: 'comfort rooms',
  toilet: 'comfort rooms', toilets: 'comfort rooms', banyo: 'comfort rooms', palikuran: 'comfort rooms', cubicle: 'comfort rooms', cubeta: 'comfort rooms',
  canteen: 'the canteen', canteens: 'the canteen', cafeteria: 'the canteen', kantina: 'the canteen', karinderya: 'the canteen', kainan: 'the canteen', makakainan: 'the canteen', foodcourt: 'the canteen',
  atm: 'banks and ATMs', atms: 'banks and ATMs', bank: 'banks and ATMs', banks: 'banks and ATMs', bangko: 'banks and ATMs', landbank: 'banks and ATMs',
  parking: 'parking', paradahan: 'parking',
  xerox: 'photocopying', photocopy: 'photocopying', photocopier: 'photocopying', photocopying: 'photocopying', magpaprint: 'photocopying', 'magpa-xerox': 'photocopying',
  dpwh: 'DPWH', lto: 'the LTO', sss: 'SSS', nbi: 'the NBI',
  passport: 'the DFA', dfa: 'the DFA', gsis: 'GSIS',
};
const LABELS_FIL = { 'comfort rooms': 'CR', 'the canteen': 'canteen', 'banks and ATMs': 'bangko at ATM', parking: 'paradahan',
                     photocopying: 'photocopy', 'the LTO': 'LTO', 'the NBI': 'NBI', 'the DFA': 'DFA' };

function words(q) {
  return String(q || '').toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\bc\.r\.?/g, 'cr')
    .replace(/comfort\s+rooms?/g, 'comfort')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

/**
 * @returns {null | { topic: 'exit'|'amenity'|'agency'|'person'|'meta'|'smalltalk', label?: string }}
 */
function classifyScope(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (SMALLTALK.test(q)) return { topic: 'smalltalk', label: THANKS.test(q) ? 'thanks' : 'hello' };
  if (PERSON.test(q)) return { topic: 'person' };
  if (META.test(q)) return { topic: 'meta' };
  const content = words(q).filter((w) => !FILLER.has(w));
  if (!content.length) return null;
  for (const topic of ['exit', 'amenity', 'agency']) {
    const vocab = TOPICS[topic];
    if (content.every((w) => vocab.has(w)) && content.some((w) => ANCHORS[topic].has(w))) {
      const anchor = content.find((w) => LABELS[w]);
      return { topic, label: anchor ? LABELS[anchor] : null };
    }
  }
  return null;
}

const HELP = 'Public Assistance Center';

/** The short reply for a topic. `lang` is 'fil' or 'en'. */
function scopeReply(found, lang) {
  const fil = lang === 'fil';
  const t = found.topic, label = found.label;
  const lf = label ? (LABELS_FIL[label] || label) : null;
  switch (t) {
    case 'exit':
      return { actions: ['exit', 'help'], answer: fil
        ? 'Ituturo ng asul na linya ang pinakamalapit na exit. I-tap ang "Nearest exit".'
        : 'The blue line can show you the nearest exit. Tap "Nearest exit".' };
    case 'amenity':
      return { actions: ['help'], answer: fil
        ? `Mga serbisyo at opisina lang ng City Hall ang kaya kong ituro. Para sa ${lf || 'iba pang pasilidad'}, magtanong po sa ${HELP} sa Ground Floor.`
        : `I can only help with City Hall services and their offices. For ${label || 'facilities like this'}, please ask at the ${HELP} on the Ground Floor.` };
    case 'agency':
      return { actions: ['help'], answer: fil
        ? `Hindi opisina ng City Hall ang ${lf || 'ahensyang iyan'}, kaya hindi ko ito maituturo. Makakapagsabi ang ${HELP} sa Ground Floor kung saan pupunta.`
        : `${label ? label.replace(/^the /, 'The ') : 'That agency'} isn't a City Hall office, so I can't show you the way there. The ${HELP} on the Ground Floor can tell you where to go.` };
    case 'person':
      return { actions: ['help'], answer: fil
        ? `Hindi ako makapagbibigay ng impormasyon tungkol sa mga opisyal. Magtanong po sa ${HELP} sa Ground Floor.`
        : `I can't give information about officials. Please ask at the ${HELP} on the Ground Floor.` };
    case 'meta':
      return { actions: [], answer: fil
        ? 'Kaya kong sabihin ang mga requirements ng mga serbisyo ng Calamba City Hall at ituro ang daan papunta sa opisina. Itanong ang serbisyo (halimbawa: cedula, business permit, solo parent ID), o i-tap ang isa sa mga mungkahi.'
        : 'I can tell you the requirements for Calamba City Hall services and show you the way to the office. Ask about a service (for example cedula, business permit or solo parent ID), or tap a suggestion.' };
    case 'smalltalk':
      if (label === 'thanks') {
        return { actions: [], answer: fil ? 'Walang anuman! May iba pa ba kayong kailangan sa City Hall?'
                                          : "You're welcome! Is there anything else you need at City Hall?" };
      }
      return { actions: [], answer: fil ? 'Magandang araw! Anong serbisyo ng City Hall ang kailangan ninyo? Halimbawa: cedula o business permit.'
                                        : 'Hello! Which City Hall service do you need? For example cedula or business permit.' };
    default:
      return null;
  }
}

/** When the best search match is too weak to trust (calibrated 2026-11-09). */
function unclearReply(lang) {
  return {
    actions: ['help'],
    answer: lang === 'fil'
      ? `Pasensya, hindi ko po naintindihan. Subukan ang pangalan ng serbisyo o opisina (halimbawa: "cedula" o "business permit"), o magtanong sa ${HELP}.`
      : `Sorry, I didn't understand that. Try the name of a service or office (for example "cedula" or "business permit"), or ask at the ${HELP}.`,
  };
}

module.exports = { classifyScope, scopeReply, unclearReply, words };
