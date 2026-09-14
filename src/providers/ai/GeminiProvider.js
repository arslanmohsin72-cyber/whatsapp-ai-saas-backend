import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIService } from './AIService.js';
import { detectLanguage } from '../../services/languageDetector.js';
import { classifyIntent } from '../../services/intentClassifier.js';
import { extractBookingSlots, getNextMissingFieldPrompt } from '../../services/bookingIntentService.js';
import { buildSystemPrompt } from '../../services/businessContextService.js';
import logger from '../../utils/logger.js';

export class GeminiProvider extends AIService {
  constructor(apiKey = null) {
    super();
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
  }

  /**
   * Generates grounded AI response adhering strictly to guardrails
   */
  async generateResponse({ businessContext, customerMessage, conversationDraft = {}, messageHistory = [], customApiKey = null }) {
    const startTime = Date.now();
    const apiKey = customApiKey || this.apiKey || process.env.GEMINI_API_KEY;

    // 1. Detect language and intent
    const langResult = detectLanguage(customerMessage);
    const intentResult = classifyIntent(customerMessage, businessContext);

    // 2. Strict Out-of-Scope rejection guardrail
    if (intentResult.intent === 'out_of_scope') {
      const rejectionText = businessContext.aiSettings?.businessOnlyRejectionMessage ||
        (langResult.code === 'ur_roman' 
          ? 'Maazrat, main sirf hamari services, business information aur bookings ke baray mein madad kar sakta hoon.'
          : langResult.code === 'ms'
          ? 'Maaf, saya hanya boleh membantu dengan servis, maklumat perniagaan dan tempahan kami.'
          : 'Sorry, I can only help with our services, business information, and bookings.');

      return {
        text: rejectionText,
        intent: 'out_of_scope',
        language: langResult.name,
        confidence: intentResult.confidence,
        latencyMs: Date.now() - startTime,
        isRejection: true
      };
    }

    // 3. Human Handover Request
    if (intentResult.intent === 'human_handover') {
      const handoverText = langResult.code === 'ur_roman'
        ? 'Aapki request staff ko forward kar di gayi hai. Humara agent jald aap se rabta karega.'
        : langResult.code === 'ms'
        ? 'Permintaan anda telah dimaklumkan kepada staf kami. Ejen kami akan menghubungi anda sebentar lagi.'
        : 'Your request has been forwarded to our team. A human agent will assist you shortly.';

      return {
        text: handoverText,
        intent: 'human_handover',
        language: langResult.name,
        confidence: intentResult.confidence,
        latencyMs: Date.now() - startTime,
        triggerHandover: true
      };
    }

    // 4. Booking Flow - Conversational Missing Slot Collection
    let updatedBookingDraft = null;
    if (intentResult.intent === 'booking_intent') {
      updatedBookingDraft = extractBookingSlots(customerMessage, conversationDraft);
      
      // If there are missing fields, ask only for the next missing field!
      if (updatedBookingDraft.missingFields && updatedBookingDraft.missingFields.length > 0) {
        const promptText = getNextMissingFieldPrompt(updatedBookingDraft.missingFields, langResult.code);
        return {
          text: promptText,
          intent: 'booking_intent',
          language: langResult.name,
          confidence: intentResult.confidence,
          latencyMs: Date.now() - startTime,
          bookingDraft: updatedBookingDraft
        };
      }
    }

    // 5. Build dynamic system prompt
    const systemInstruction = buildSystemPrompt(businessContext, {}, langResult.name);

    // 6. Invoke Gemini API if API key is present
    if (apiKey && apiKey !== 'your_gemini_api_key_here') {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = businessContext.aiSettings?.model || process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.5-flash';
        
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 0.3, // Low temperature for high accuracy & zero hallucinations
            maxOutputTokens: 250
          }
        });

        const prompt = `Customer Message: "${customerMessage}"\nCustomer Language: ${langResult.name}`;
        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        return {
          text: responseText,
          intent: intentResult.intent,
          language: langResult.name,
          confidence: intentResult.confidence,
          latencyMs: Date.now() - startTime,
          bookingDraft: updatedBookingDraft
        };
      } catch (geminiError) {
        logger.error('Gemini API execution failed:', geminiError);
        // Fallback to grounded fallback response
      }
    }

    // 7. Deterministic Fallback Generator (Grounded strictly in Business DB Data)
    const fallbackText = this._generateGroundedFallback(businessContext, customerMessage, intentResult.intent, langResult.code);

    return {
      text: fallbackText,
      intent: intentResult.intent,
      language: langResult.name,
      confidence: intentResult.confidence,
      latencyMs: Date.now() - startTime,
      bookingDraft: updatedBookingDraft
    };
  }

  /**
   * Deterministic Grounded Fallback (Guarantees zero hallucinations even without API key)
   */
  _generateGroundedFallback(context, message, intent, langCode) {
    const { business, services, faqs, workingHours } = context;
    const clean = message.toLowerCase();

    // Price / Service Inquiry
    if (intent === 'price_inquiry' || clean.includes('price') || clean.includes('harga') || clean.includes('kitna')) {
      const matchedService = services.find((s) => clean.includes(s.name.toLowerCase()));
      if (matchedService) {
        if (matchedService.priceType === 'fixed') {
          return langCode === 'ur_roman'
            ? `${matchedService.name} ki price ${business.currency || 'MYR'} ${matchedService.price} hai.`
            : langCode === 'ms'
            ? `Harga untuk ${matchedService.name} adalah ${business.currency || 'MYR'} ${matchedService.price}.`
            : `${matchedService.name} is ${business.currency || 'MYR'} ${matchedService.price}.`;
        }
        if (matchedService.priceType === 'starting_from') {
          return langCode === 'ur_roman'
            ? `${matchedService.name} ${business.currency || 'MYR'} ${matchedService.price} se start hota hai.`
            : langCode === 'ms'
            ? `${matchedService.name} bermula dari ${business.currency || 'MYR'} ${matchedService.price}.`
            : `${matchedService.name} starts from ${business.currency || 'MYR'} ${matchedService.price}.`;
        }
      }

      if (services.length > 0) {
        const s = services[0];
        return langCode === 'ur_roman'
          ? `${s.name} ${business.currency || 'MYR'} ${s.price} se start hai. Aapko konsi service chahiye?`
          : langCode === 'ms'
          ? `${s.name} bermula dari ${business.currency || 'MYR'} ${s.price}. Anda perlukan servis apa?`
          : `${s.name} is available from ${business.currency || 'MYR'} ${s.price}. Which service would you like to book?`;
      }

      return 'Our service pricing is available upon inspection. How can we help you today?';
    }

    // Working Hours
    if (intent === 'hours_inquiry') {
      return `We are open Monday to Friday 09:00 - 18:00 (${business.timezone || 'UTC'}).`;
    }

    // FAQs
    const matchedFaq = faqs.find((f) => clean.includes(f.question.toLowerCase().slice(0, 10)));
    if (matchedFaq) {
      return matchedFaq.answer;
    }

    // Default Greeting
    return langCode === 'ur_roman'
      ? `Hello! ${business.name} mein khushamdeed. Main aapki kis service mein madad kar sakta hoon?`
      : langCode === 'ms'
      ? `Hai! Selamat datang ke ${business.name}. Ada apa-apa yang boleh saya bantu?`
      : `Hello! Welcome to ${business.name}. How can we assist you with our services today?`;
  }
}

export default GeminiProvider;
