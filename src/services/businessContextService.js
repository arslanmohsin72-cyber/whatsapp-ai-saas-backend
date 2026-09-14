import { Business } from '../models/Business.js';
import { Service } from '../models/Service.js';
import { ServiceArea } from '../models/ServiceArea.js';
import { FAQ } from '../models/FAQ.js';
import { Policy } from '../models/Policy.js';
import { WorkingHours } from '../models/WorkingHours.js';
import { AISettings } from '../models/AISettings.js';
import logger from '../utils/logger.js';

export const getBusinessContext = async (businessId) => {
  try {
    const [business, services, areas, faqs, policies, workingHours, aiSettings] = await Promise.all([
      Business.findById(businessId).lean(),
      Service.find({ businessId, active: true }).lean(),
      ServiceArea.find({ businessId, active: true }).lean(),
      FAQ.find({ businessId, active: true }).lean(),
      Policy.find({ businessId, active: true }).lean(),
      WorkingHours.findOne({ businessId }).lean(),
      AISettings.findOne({ businessId }).lean()
    ]);

    return {
      business: business || { name: 'Business', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
      services: services || [],
      areas: areas || [],
      faqs: faqs || [],
      policies: policies || [],
      workingHours: workingHours || null,
      aiSettings: aiSettings || null
    };
  } catch (error) {
    logger.error(`Error loading business context for ${businessId}:`, error);
    return {
      business: { name: 'Business', currency: 'MYR' },
      services: [],
      areas: [],
      faqs: [],
      policies: [],
      workingHours: null,
      aiSettings: null
    };
  }
};

/**
 * Builds the strict, grounded System Prompt for Gemini
 */
export const buildSystemPrompt = (context, customerInfo = {}, detectedLanguage = 'English') => {
  const { business, services, areas, faqs, policies, workingHours, aiSettings } = context;

  // Format Services
  const servicesList = (services || []).map((s) => {
    let priceStr = 'Price unavailable (quote upon inspection)';
    if (s.priceType === 'fixed') priceStr = `${business?.currency || 'MYR'} ${s.price}`;
    else if (s.priceType === 'starting_from') priceStr = `From ${business?.currency || 'MYR'} ${s.price}`;
    else if (s.priceType === 'range') priceStr = `${business?.currency || 'MYR'} ${s.price} - ${s.priceMax}`;
    else if (s.priceType === 'contact_for_price') priceStr = 'Contact for custom quotation';

    return `- ${s.name} (${s.category || 'General'}): ${priceStr}. Duration: ${s.duration || 60} mins. Description: ${s.description || 'N/A'}`;
  }).join('\n');

  // Format Service Areas
  const areasList = (areas || []).map((a) => `- ${a.area}, ${a.city} ${a.postcode ? `(${a.postcode})` : ''}`).join('\n');

  // Format FAQs
  const faqsList = (faqs || []).map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');

  // Format Policies
  const policiesList = (policies || []).map((p) => `[${p.title} (${p.policyType})]: ${p.content}`).join('\n');

  // Format Working Hours
  let hoursList = 'Working hours not specified';
  if (workingHours && workingHours.schedule) {
    hoursList = workingHours.schedule
      .map((d) => `${d.day}: ${d.isOpen ? `${d.openTime} - ${d.closeTime}` : 'CLOSED'}`)
      .join(', ');
  }

  const tone = aiSettings?.defaultTone || 'friendly and professional';
  const responseStyle = aiSettings?.responseStyle || 'short and direct';
  const customInstructions = aiSettings?.customInstructions || '';
  const useEmojis = aiSettings?.useEmojis !== false;

  return `You are the official AI Assistant for "${business.name}".
Your role is to assist customers via WhatsApp with services, prices, coverage areas, operating hours, FAQs, policies, and booking requests.

=== BUSINESS KNOWLEDGE (VERIFIED GROUND TRUTH) ===
Business Name: ${business.name}
Description: ${business.description || 'Professional Services'}
Phone: ${business.phone || business.whatsappNumber || 'N/A'}
Email: ${business.email || 'N/A'}
Address: ${business.address || ''}, ${business.city || ''}, ${business.country || ''}
Currency: ${business.currency || 'MYR'}
Timezone: ${business.timezone || 'Asia/Kuala_Lumpur'}

--- VERIFIED SERVICES & PRICING ---
${servicesList || 'No services currently listed. Direct inquiries to staff.'}

--- COVERAGE AREAS ---
${areasList || 'Area coverage upon inquiry.'}

--- WORKING HOURS (${business.timezone || 'UTC'}) ---
${hoursList}

--- BUSINESS POLICIES & WARRANTIES ---
${policiesList || 'Standard customer service policies apply.'}

--- FREQUENTLY ASKED QUESTIONS ---
${faqsList || 'None'}

=== STRICT GUARDRAIL RULES (ZERO TOLERANCE FOR VIOLATIONS) ===
1. NO HALLUCINATION: You MUST NEVER invent services, prices, discounts, warranties, opening hours, or coverage areas that are not listed above. If a price or service is not in the database, explicitly state: "The exact price for this is not currently listed. Our team can provide a tailored quote upon inspection."
2. BUSINESS-ONLY MODE: You are ONLY allowed to answer questions related to "${business.name}", its services, bookings, hours, and policies. If the user asks about weather, coding, politics, recipes, general homework, or unrelated topics, politely reject with: "Sorry, I can only help with our services, business information, and bookings."
3. NO FALSE BOOKING CONFIRMATION: You MUST NEVER say "Your booking is confirmed." Only say "Your booking request has been received and our team will review it shortly."
4. LANGUAGE & TONE MATCHING:
   - Detect and strictly match the customer's language and dialect (${detectedLanguage}).
   - If customer speaks English -> Reply in English.
   - If customer speaks Urdu / Roman Urdu -> Reply in natural Roman Urdu (e.g. "AC service RM90 se start hai. Aapka AC kitne HP ka hai?").
   - If customer speaks Malay -> Reply in natural Bahasa Melayu (cth: "Servis aircond bermula dari RM90. Berapa unit nak diservis?").
   - If customer speaks Arabic -> Reply in Arabic.
5. CONCISE WHATSAPP STYLE: Keep messages ${responseStyle}. Avoid lengthy introductory fluff, disclaimers, or giant paragraphs. Respond directly to the point.
6. EMOJIS: ${useEmojis ? 'Use subtle, appropriate emojis (max 1-2 per message).' : 'Do NOT use emojis.'}
7. CUSTOM BUSINESS INSTRUCTIONS:
${customInstructions || 'None'}
`;
};

export default { getBusinessContext, buildSystemPrompt };
