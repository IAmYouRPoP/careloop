// Interface translations. English text is the key; anything missing falls back to English.
// Covers the patient-facing screens. Staff/admin pages stay English, and clinical content
// (instructions, medicine names, notes) always shows exactly as the hospital entered it.

let current = 'en';
try { current = localStorage.getItem('cl_lang') === 'hi' ? 'hi' : 'en'; } catch {}

export const getLang = () => current;
export const locale = () => (current === 'hi' ? 'hi-IN' : 'en-IN');

export function setLang(lang) {
  current = lang === 'hi' ? 'hi' : 'en';
  try { localStorage.setItem('cl_lang', current); } catch {}
  document.documentElement.lang = current;
}
document.documentElement.lang = current;

export function t(text, vars) {
  let out = current === 'hi' ? (HI[text] ?? text) : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return out;
}

const HI = {
  // navigation & shell
  'Home': 'होम', 'Book': 'बुक करें', 'My visits': 'मेरी विज़िट', 'Offers': 'ऑफ़र', 'Reminders': 'रिमाइंडर',
  'Caring': 'देखभाल', 'Symptom guide': 'लक्षण गाइड', 'Conditions': 'बीमारियाँ', 'Profile': 'प्रोफ़ाइल',
  'Log in': 'लॉग इन', 'Sign up': 'साइन अप', 'Log out': 'लॉग आउट', 'Loading…': 'लोड हो रहा है…',
  'Demo build with synthetic data. Not for real medical use.': 'यह डेमो है, इसमें काल्पनिक डेटा है। असली इलाज के लिए उपयोग न करें।',
  'In an emergency call 112 or 108.': 'आपातकाल में 112 या 108 पर कॉल करें।',

  // status badges
  'Booked': 'बुक है', 'Checked in': 'चेक-इन हो गया', 'With doctor': 'डॉक्टर के पास', 'Completed': 'पूरा हुआ',
  'No-show': 'नहीं आए', 'Cancelled': 'रद्द', 'Ready': 'तैयार', 'Not ready': 'तैयार नहीं', 'Nothing pending': 'कुछ बाकी नहीं',
  'Waiting': 'इंतज़ार में', 'Called': 'बुलाया गया', 'Being seen': 'जाँच चल रही है', 'Done': 'पूरा', 'Skipped': 'छोड़ा गया',
  'Emergency': 'आपातकाल', 'Today': 'आज', 'This week': 'इस हफ़्ते', 'Routine': 'सामान्य',
  'Go to emergency now': 'अभी आपातकालीन विभाग जाएँ', 'Try to be seen today': 'आज ही दिखाएँ',
  'Book within the next few days': 'अगले कुछ दिनों में बुक करें', 'Book at a convenient time': 'सुविधा अनुसार बुक करें',
  'Document': 'दस्तावेज़', 'Fasting': 'उपवास', 'To do': 'करना है', 'Good to know': 'जानकारी',

  // departments
  'General Medicine': 'सामान्य चिकित्सा', 'Cardiology': 'हृदय रोग', 'Pathology Lab': 'पैथोलॉजी लैब', 'Radiology': 'रेडियोलॉजी',
  'Orthopaedics': 'हड्डी रोग', 'ENT': 'नाक, कान, गला (ENT)', 'Dermatology': 'त्वचा रोग', 'Neurology': 'तंत्रिका रोग',
  'Gastroenterology': 'पेट और लिवर रोग', 'Pulmonology': 'फेफड़े रोग', 'Ophthalmology': 'नेत्र रोग', 'Urology': 'मूत्र रोग',
  'Gynaecology': 'स्त्री रोग', 'Paediatrics': 'बाल रोग', 'Psychiatry': 'मानसिक स्वास्थ्य', 'Dentistry': 'दंत चिकित्सा',

  // landing
  'Synthetic demo': 'डेमो',
  'From “what’s wrong?” to “what do I do next?”': '“क्या हुआ है?” से “अब क्या करूँ?” तक',
  'CareLoop guides you before, during and after a hospital visit: the right department, a checklist so you arrive ready, and a live queue so you know your turn.':
    'CareLoop अस्पताल जाने से पहले, दौरान और बाद में आपका साथ देता है: सही विभाग, एक चेकलिस्ट ताकि आप पूरी तैयारी से आएँ, और लाइव कतार ताकि आपको अपनी बारी पता रहे।',
  'Find the right department': 'सही विभाग खोजें', 'Create an account': 'खाता बनाएँ', 'Go to my dashboard': 'मेरे डैशबोर्ड पर जाएँ',
  'Find care': 'देखभाल खोजें', 'Before': 'पहले', 'During': 'दौरान', 'After': 'बाद में',
  'Readiness check': 'तैयारी जाँच', 'Live queue': 'लाइव कतार', 'Recovery checklist': 'रिकवरी चेकलिस्ट',
  'Describe how you feel; get a department and how soon to go. Emergencies are flagged first.': 'बताइए आप कैसा महसूस कर रहे हैं; विभाग और कितनी जल्दी जाना है, यह जानें। आपातकाल सबसे पहले पहचाना जाता है।',
  'A checklist from the hospital’s own instructions, with flags for missing documents and fasting.': 'अस्पताल के अपने निर्देशों से बनी चेकलिस्ट, छूटे दस्तावेज़ों और उपवास की चेतावनी के साथ।',
  'Check in from your phone, see your position and an honest wait estimate.': 'फ़ोन से चेक-इन करें, कतार में अपना स्थान और इंतज़ार का सही अनुमान देखें।',
  'Follow-up dates, medicine times and reminders from your care team, shared with family if you choose.': 'फ़ॉलो-अप की तारीख, दवा का समय और रिमाइंडर, चाहें तो परिवार के साथ साझा करें।',
  'Try it': 'आज़माएँ', 'Book a visit': 'विज़िट बुक करें', 'See my visits': 'मेरी विज़िट देखें', 'See my recovery': 'मेरी रिकवरी देखें',

  // auth
  'Patients, staff and admins all log in here.': 'मरीज़, स्टाफ़ और एडमिन सभी यहीं लॉग इन करें।',
  'Email': 'ईमेल', 'Password': 'पासवर्ड', 'New patient?': 'नए मरीज़?', 'Already registered?': 'पहले से पंजीकृत?',
  'Create a patient account': 'मरीज़ खाता बनाएँ', 'Full name': 'पूरा नाम', 'Date of birth': 'जन्म तिथि', 'Create account': 'खाता बनाएँ',
  'Staff accounts are created by the hospital admin.': 'स्टाफ़ खाते अस्पताल एडमिन बनाते हैं।',

  // symptom guide
  'Tell us how you feel. We suggest a department and how soon to be seen. We never diagnose.':
    'बताइए आप कैसा महसूस कर रहे हैं। हम विभाग और कितनी जल्दी दिखाना है, यह सुझाएँगे। हम निदान नहीं करते।',
  'In an emergency, don’t use this.': 'आपातकाल में इसका उपयोग न करें।',
  'Call {a} or {b} for an ambulance.': '{a} पर कॉल करें, या एम्बुलेंस के लिए {b}।',
  'Describe your symptoms': 'अपने लक्षण बताइए', 'Get guidance': 'सलाह पाएँ',
  'e.g. I’ve had a sore throat and fever since yesterday': 'जैसे: कल से गले में खराश और बुखार है',
  'Suggested department': 'सुझाया गया विभाग', 'Book a visit in {dept}': '{dept} में विज़िट बुक करें',
  'Possible emergency': 'संभावित आपातकाल', 'Recognised:': 'पहचाने गए:', 'Call 112': '112 पर कॉल करें', 'Call 108 (ambulance)': '108 पर कॉल करें (एम्बुलेंस)',
  'EMERGENCY_MESSAGE': 'आपके विवरण में आपातकाल का संकेत हो सकता है। अभी 112 (एम्बुलेंस के लिए 108) पर कॉल करें या नज़दीकी आपातकालीन विभाग जाएँ। बुकिंग का इंतज़ार न करें।',
  'DISCLAIMER': 'CareLoop विभाग और कितनी जल्दी दिखाना है, यह सुझाता है। यह निदान नहीं करता और दवा की सलाह नहीं देता। तबीयत बिगड़े या चिंता हो तो डॉक्टर से मिलें या नज़दीकी आपातकालीन विभाग जाएँ।',
  'No listed symptom matched. General Medicine can assess you and refer you on.': 'कोई सूचीबद्ध लक्षण नहीं मिला। सामान्य चिकित्सा विभाग आपकी जाँच करके आगे भेज सकता है।',

  // home & visits
  'Hello, {name}': 'नमस्ते, {name}', 'Here’s what’s coming up.': 'आपकी आने वाली विज़िट।', 'Next visit': 'अगली विज़िट',
  'Prepare': 'तैयारी', 'Check in & queue': 'चेक-इन और कतार', 'Token {n}': 'टोकन {n}', 'Details': 'विवरण',
  'No upcoming visits.': 'कोई आने वाली विज़िट नहीं।', 'Also coming up': 'और आने वाली विज़िट', 'Recovering': 'रिकवरी',
  'Recovery plan · {dept}': 'रिकवरी योजना · {dept}', 'Tasks & medicine times →': 'काम और दवा का समय →',
  'Overview': 'सारांश', 'Queue': 'कतार', 'Recovery': 'रिकवरी', '← My visits': '← मेरी विज़िट',

  // readiness
  'You’re ready.': 'आप तैयार हैं।', 'All documents and fasting steps are confirmed.': 'सभी दस्तावेज़ और उपवास की पुष्टि हो गई है।',
  'Not ready yet.': 'अभी तैयार नहीं।', 'Sort these out before you travel:': 'निकलने से पहले ये पूरा करें:',

  // queue
  'Your token': 'आपका टोकन', 'Position': 'कतार में स्थान', '{n} ahead of you': 'आपसे पहले {n}', 'Estimated wait': 'अनुमानित इंतज़ार',
  'It’s your turn': 'आपकी बारी है', 'You’re being seen': 'आपकी जाँच चल रही है', 'Please go to {place}.': 'कृपया {place} जाएँ।',
  'Live: updates automatically': 'लाइव: अपने आप अपडेट होता है', 'Check in': 'चेक-इन करें',
  'Arrived at the hospital?': 'अस्पताल पहुँच गए?', 'Check-in opens on the day': 'चेक-इन विज़िट के दिन खुलेगा',
  'Check in to get your token and see your place in the queue.': 'टोकन पाने और कतार में अपना स्थान देखने के लिए चेक-इन करें।',
  'You missed your turn': 'आपकी बारी निकल गई', 'You’re next': 'अगली बारी आपकी है',
  'Based on {n} recent visits in this department.': 'इस विभाग की हाल की {n} विज़िट पर आधारित।',
  'Low confidence:': 'कम भरोसा:', 'Alert me when it’s my turn': 'मेरी बारी आने पर सूचना दें',

  // recovery
  'Follow-up visit': 'फ़ॉलो-अप विज़िट', 'From your care team': 'आपकी देखभाल टीम की ओर से', 'Medicines': 'दवाइयाँ',
  '{a} of {b} done': '{b} में से {a} पूरे', 'Today:': 'आज:', 'Book follow-up slot': 'फ़ॉलो-अप स्लॉट बुक करें',
  'Tomorrow': 'कल', 'In {n} days': '{n} दिन में',

  // condition lookup
  'Condition lookup': 'बीमारी खोजें',
  'Search a condition to see its common symptoms, which department treats it, and trusted sources.': 'किसी बीमारी को खोजें और उसके आम लक्षण, इलाज करने वाला विभाग और भरोसेमंद स्रोत देखें।',
  'No matching condition. Try another word, or use the symptom guide.': 'कोई बीमारी नहीं मिली। दूसरा शब्द आज़माएँ या लक्षण गाइड का उपयोग करें।',

  // offers
  'Earlier slots': 'जल्दी के स्लॉट', 'Earlier slot available': 'जल्दी का स्लॉट उपलब्ध', 'Move to the earlier slot': 'जल्दी वाले स्लॉट पर जाएँ',
  'Keep my current time': 'मेरा मौजूदा समय रखें', 'Your current time': 'आपका मौजूदा समय', 'New time': 'नया समय',
};
