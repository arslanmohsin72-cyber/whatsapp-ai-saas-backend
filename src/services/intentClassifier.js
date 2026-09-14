/**
 * Fast Rule & Keyword Intent Classifier for Guardrails & Message Routing
 */
export const classifyIntent = (text = '', businessContext = {}) => {
  if (!text || typeof text !== 'string') return { intent: 'greeting', confidence: 0.5 };

  const clean = text.trim().toLowerCase();

  // 1. Human Handover Request / Angry Customer
  const humanKeywords = [
    'human', 'agent', 'person', 'operator', 'talk to person', 'speak to human', 
    'real person', 'manager', 'owner', 'complaint', 'scam', 'police', 'cheat',
    'bhai kisi bande se baat karwao', 'insan se baat', 'agent chahiye', 'cakap dengan orang'
  ];
  if (humanKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'human_handover', confidence: 0.95 };
  }

  // 2. Out of Scope Rejections (Strict Business-Only Guardrail)
  const outOfScopeKeywords = [
    'weather', 'coding', 'write code', 'c++', 'javascript', 'python', 'java', 
    'html', 'react', 'poem', 'joke', 'story', 'homework', 'math', 'calculate', 
    'formula', 'politics', 'election', 'minister', 'president', 'movie', 'song',
    'cricket score', 'football score', 'recipe', 'cook'
  ];
  if (outOfScopeKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'out_of_scope', confidence: 0.98 };
  }

  // 3. Booking Intent
  const bookingKeywords = [
    'book', 'booking', 'schedule', 'appointment', 'reserve', 'slot',
    'come tomorrow', 'come today', 'need service tomorrow', 'send technician',
    'send someone', 'fix my', 'repair my', 'install my',
    'kal aa sakte', 'book karna hai', 'service chahiye', 'banda bhejo',
    'nak book', 'nak servis esok', 'hantar orang', 'temujanji'
  ];
  if (bookingKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'booking_intent', confidence: 0.9 };
  }

  // 4. Price Inquiry (Separate from booking intent)
  const priceKeywords = [
    'price', 'cost', 'how much', 'rate', 'charges', 'fee', 'charge',
    'kitna', 'kitne', 'charges kitne', 'price batao', 'rate kya hai',
    'berapa', 'harga', 'kos', 'berapa rm'
  ];
  if (priceKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'price_inquiry', confidence: 0.92 };
  }

  // 5. Service Area / Coverage Inquiry
  const areaKeywords = [
    'area', 'location', 'cover', 'serve', 'deliver', 'city', 'postcode',
    'kahan', 'area konsa', 'idhar aate ho', 'kuching', 'kl', 'selangor', 'pj', 'lahore', 'karachi',
    'kawasan', 'lokasi', 'tempat'
  ];
  if (areaKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'area_inquiry', confidence: 0.88 };
  }

  // 6. Working Hours Inquiry
  const hoursKeywords = [
    'open', 'close', 'hours', 'time', 'timing', 'sunday', 'weekend', 'holiday',
    'khula hai', 'band kab', 'timing kya hai', 'chutti', 'buka', 'tutup', 'waktu operasi'
  ];
  if (hoursKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'hours_inquiry', confidence: 0.88 };
  }

  // 7. Policy / Warranty / FAQs
  const policyKeywords = ['warranty', 'guarantee', 'cancel', 'refund', 'policy', 'terms', 'payment method', 'cash', 'transfer'];
  if (policyKeywords.some((kw) => clean.includes(kw))) {
    return { intent: 'policy_inquiry', confidence: 0.85 };
  }

  // 8. General Greetings
  const greetingKeywords = ['hi', 'hello', 'hey', 'salam', 'assalam', 'aoa', 'selamat', 'morning', 'evening', 'halo'];
  if (greetingKeywords.some((kw) => clean === kw || clean.startsWith(kw + ' '))) {
    return { intent: 'greeting', confidence: 0.8 };
  }

  return { intent: 'general_inquiry', confidence: 0.7 };
};

export default { classifyIntent };
