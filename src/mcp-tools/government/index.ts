/**
 * @file mcp-tools/government/index.ts — Government Scheme Tools
 * 
 * WHY: India has numerous government health and welfare schemes
 * (Ayushman Bharat, PMJAY, CMCHIS, etc.) but citizens often don't
 * know which ones they qualify for. These tools help users:
 * 1. Discover relevant schemes
 * 2. Check eligibility based on their profile
 * 3. Get step-by-step application guidance
 * 4. Track application status
 * 
 * HACKATHON NOTE: Uses a static knowledge base of schemes. In
 * production, integrate with government APIs (DigiLocker, UMANG).
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('GovernmentTools');

// ─── Static Scheme Database ─────────────────────────────────────
// WHY static: Government APIs are unreliable and often down.
// A cached local database ensures the bot always works.
// In production, this would be periodically synced from gov.in APIs.

const SCHEMES = [
  {
    id: 'ayushman-bharat',
    name: { english: 'Ayushman Bharat (PM-JAY)', tamil: 'ஆயுஷ்மான் பாரத்', hindi: 'आयुष्मान भारत' },
    description: {
      english: 'Free health insurance up to ₹5 lakh per family per year for secondary and tertiary care hospitalization.',
      tamil: 'குடும்பத்திற்கு ஆண்டுக்கு ₹5 லட்சம் வரை இலவச மருத்துவ காப்பீடு.',
      hindi: 'प्रति परिवार प्रति वर्ष ₹5 लाख तक का मुफ्त स्वास्थ्य बीमा।',
    },
    eligibility: [
      { field: 'annual_income', operator: 'lt' as const, value: 200000, description: 'Annual income below ₹2 lakh' },
      { field: 'has_ration_card', operator: 'eq' as const, value: true, description: 'Must have BPL ration card' },
    ],
    required_documents: ['Aadhaar Card', 'Ration Card (BPL)', 'Income Certificate', 'Family ID'],
    application_steps: [
      'Visit the nearest Ayushman Bharat centre or Common Service Centre (CSC)',
      'Carry your Aadhaar card and ration card',
      'The operator will verify your eligibility using your Aadhaar number',
      'If eligible, your e-card will be generated on the spot',
      'Download the Ayushman Bharat app for digital access',
    ],
    category: 'health',
    portal_url: 'https://pmjay.gov.in',
  },
  {
    id: 'cmchis',
    name: { english: 'CMCHIS (TN Chief Minister\'s Health Insurance)', tamil: 'முதலமைச்சர் மருத்துவக் காப்பீட்டுத் திட்டம்', hindi: 'सीएमसीएचआईएस' },
    description: {
      english: 'Tamil Nadu state health insurance covering up to ₹5 lakh for 1,027+ procedures.',
      tamil: '1,027+ மருத்துவ நடைமுறைகளுக்கு ₹5 லட்சம் வரை காப்பீடு.',
      hindi: '1,027+ प्रक्रियाओं के लिए ₹5 लाख तक का कवर।',
    },
    eligibility: [
      { field: 'state', operator: 'eq' as const, value: 'Tamil Nadu', description: 'Must be Tamil Nadu resident' },
      { field: 'annual_income', operator: 'lt' as const, value: 72000, description: 'Annual income below ₹72,000' },
    ],
    required_documents: ['Aadhaar Card', 'Family Card', 'Income Certificate', 'Smart Ration Card'],
    application_steps: [
      'Visit your nearest CMCHIS empanelled hospital',
      'Show your Smart Ration Card at the CMCHIS desk',
      'The hospital will verify your eligibility online',
      'Treatment is cashless once approved',
    ],
    category: 'health',
    portal_url: 'https://www.cmchistn.com',
  },
  {
    id: 'pm-kisan',
    name: { english: 'PM-KISAN', tamil: 'பிஎம்-கிசான்', hindi: 'पीएम-किसान' },
    description: {
      english: 'Direct income support of ₹6,000/year in 3 installments for small farmers.',
      tamil: 'சிறு விவசாயிகளுக்கு 3 தவணைகளில் ₹6,000/ஆண்டு நேரடி வருமான ஆதரவு.',
      hindi: 'छोटे किसानों को 3 किस्तों में ₹6,000/वर्ष की प्रत्यक्ष आय सहायता।',
    },
    eligibility: [
      { field: 'occupation', operator: 'eq' as const, value: 'farmer', description: 'Must be a registered farmer' },
      { field: 'land_holding', operator: 'lt' as const, value: 2, description: 'Land holding less than 2 hectares' },
    ],
    required_documents: ['Aadhaar Card', 'Land Records', 'Bank Account Details', 'Kisan Credit Card (optional)'],
    application_steps: [
      'Visit https://pmkisan.gov.in or your village panchayat office',
      'Register with Aadhaar number and bank details',
      'Submit land ownership documents',
      'Verification by state/district agriculture officer',
      '₹2,000 deposited every 4 months after approval',
    ],
    category: 'agriculture',
    portal_url: 'https://pmkisan.gov.in',
  },
  {
    id: 'sukanya-samriddhi',
    name: { english: 'Sukanya Samriddhi Yojana', tamil: 'சுகன்யா சம்ரிதி யோஜனா', hindi: 'सुकन्या समृद्धि योजना' },
    description: {
      english: 'Savings scheme for girl child education/marriage. High interest rate (8.2%), tax benefits under 80C.',
      tamil: 'பெண் குழந்தை கல்வி/திருமணத்திற்கான சேமிப்பு திட்டம். 8.2% வட்டி விகிதம்.',
      hindi: 'बेटी की शिक्षा/शादी के लिए बचत योजना। 8.2% ब्याज दर।',
    },
    eligibility: [
      { field: 'child_gender', operator: 'eq' as const, value: 'female', description: 'For girl children only' },
      { field: 'child_age', operator: 'lt' as const, value: 10, description: 'Girl must be under 10 years old' },
    ],
    required_documents: ['Birth Certificate of girl child', 'Parent Aadhaar Card', 'Address Proof', 'Passport-size photos'],
    application_steps: [
      'Visit any post office or authorized bank (SBI, ICICI, PNB, etc.)',
      'Fill Form-1 (Sukanya Samriddhi Account opening form)',
      'Submit birth certificate and parent ID proof',
      'Make initial deposit (minimum ₹250)',
      'Account matures when the girl turns 21',
    ],
    category: 'savings',
    portal_url: 'https://www.india.gov.in/sukanya-samriddhi-yojna',
  },
];

// ─── 1. Scheme Search ───────────────────────────────────────────
ToolRegistry.register(
  {
    name: 'scheme_search',
    description: 'Search for government schemes by category, keyword, or need. Returns matching schemes with descriptions in the user\'s preferred language.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "health insurance", "farmer support", "girl child savings")' },
        category: { type: 'string', description: 'Category filter: health, agriculture, education, savings, housing' },
        language: { type: 'string', description: 'Preferred language: english, tamil, hindi' },
      },
      required: ['query'],
    },
  },
  async (args) => {
    const { query, category, language } = args as { query: string; category?: string; language?: string };
    const lang = (language as 'english' | 'tamil' | 'hindi') || 'english';
    const lower = query.toLowerCase();

    const results = SCHEMES.filter((s) => {
      if (category && s.category !== category) return false;
      const nameMatch = Object.values(s.name).some((n) => n.toLowerCase().includes(lower));
      const descMatch = Object.values(s.description).some((d) => d.toLowerCase().includes(lower));
      const catMatch = s.category.includes(lower);
      return nameMatch || descMatch || catMatch;
    });

    return {
      schemes: results.map((s) => ({
        id: s.id,
        name: s.name[lang] || s.name.english,
        description: s.description[lang] || s.description.english,
        category: s.category,
        portal_url: s.portal_url,
      })),
      total: results.length,
      query,
    };
  },
  z.object({ query: z.string(), category: z.string().optional(), language: z.string().optional() })
);

// ─── 2. Eligibility Checker ─────────────────────────────────────
ToolRegistry.register(
  {
    name: 'eligibility_checker',
    description: 'Check if a user is eligible for a specific government scheme based on their profile.',
    input_schema: {
      type: 'object',
      properties: {
        scheme_id: { type: 'string', description: 'ID of the scheme to check (from scheme_search results)' },
        user_profile: { type: 'string', description: 'JSON string of user details: { annual_income, state, occupation, child_age, child_gender, has_ration_card, land_holding }' },
      },
      required: ['scheme_id', 'user_profile'],
    },
  },
  async (args) => {
    const { scheme_id, user_profile } = args as { scheme_id: string; user_profile: string };
    const scheme = SCHEMES.find((s) => s.id === scheme_id);

    if (!scheme) {
      return { eligible: false, reason: `Scheme '${scheme_id}' not found.` };
    }

    let profile: Record<string, any>;
    try { profile = JSON.parse(user_profile); }
    catch { return { eligible: false, reason: 'Invalid user profile format.' }; }

    const results = scheme.eligibility.map((rule) => {
      const userValue = profile[rule.field];
      if (userValue === undefined) return { ...rule, met: null, reason: `${rule.field} not provided` };

      let met = false;
      switch (rule.operator as string) {
        case 'lt': met = userValue < rule.value; break;
        case 'gt': met = userValue > rule.value; break;
        case 'eq': met = userValue === rule.value; break;
        case 'in': met = Array.isArray(rule.value) && rule.value.includes(userValue); break;
      }
      return { ...rule, met, reason: met ? 'Meets criteria' : `Does not meet: ${rule.description}` };
    });

    const eligible = results.every((r) => r.met === true || r.met === null);
    const missing = results.filter((r) => r.met === null).map((r) => r.field);

    return {
      scheme_name: scheme.name.english,
      eligible,
      missing_info: missing,
      criteria_results: results,
      required_documents: scheme.required_documents,
      next_steps: eligible ? scheme.application_steps : ['Please ensure you meet all eligibility criteria before applying.'],
    };
  },
  z.object({ scheme_id: z.string(), user_profile: z.string() })
);

// ─── 3. Application Tracker ─────────────────────────────────────
ToolRegistry.register(
  {
    name: 'application_tracker',
    description: 'Check the status of a government scheme application using the tracking ID.',
    input_schema: {
      type: 'object',
      properties: {
        tracking_id: { type: 'string', description: 'Application tracking ID' },
        scheme_id: { type: 'string', description: 'Scheme ID' },
      },
      required: ['tracking_id'],
    },
  },
  async (args) => {
    const { tracking_id } = args as { tracking_id: string };
    // HACKATHON NOTE: In production, query the actual government portal API
    return {
      tracking_id,
      status: 'pending',
      submitted_date: '2025-01-15',
      estimated_processing_days: 30,
      current_stage: 'Document Verification',
      next_action: 'No action needed. Your application is being reviewed.',
      helpline: '14555 (PM-JAY helpline)',
    };
  },
  z.object({ tracking_id: z.string(), scheme_id: z.string().optional() })
);

// ─── 4. Document Helper ─────────────────────────────────────────
ToolRegistry.register(
  {
    name: 'document_helper',
    description: 'List required documents for a government scheme and provide guidance on how to obtain them.',
    input_schema: {
      type: 'object',
      properties: {
        scheme_id: { type: 'string', description: 'Scheme ID to get document requirements for' },
        language: { type: 'string', description: 'Language for response: english, tamil, hindi' },
      },
      required: ['scheme_id'],
    },
  },
  async (args) => {
    const { scheme_id } = args as { scheme_id: string };
    const scheme = SCHEMES.find((s) => s.id === scheme_id);
    if (!scheme) return { error: 'Scheme not found' };

    const docGuide: Record<string, string> = {
      'Aadhaar Card': 'Apply at any Aadhaar Enrolment Centre. Need: proof of identity and address. Free for first issuance.',
      'Ration Card': 'Apply online at tnpds.gov.in (Tamil Nadu) or visit your taluk supply office.',
      'Income Certificate': 'Apply at your taluk/district revenue office or e-district portal. Need: salary slip or self-declaration.',
      'Birth Certificate': 'Available from municipal/panchayat office where the birth was registered.',
      'Bank Account Details': 'Open a zero-balance Jan Dhan account at any public sector bank with Aadhaar.',
      'Land Records': 'Available at village administrative officer (VAO) or patta.tn.gov.in for Tamil Nadu.',
      'Family Card': 'Available from municipal corporation or panchayat office.',
    };

    return {
      scheme_name: scheme.name.english,
      required_documents: scheme.required_documents.map((doc) => ({
        name: doc,
        how_to_obtain: docGuide[doc] || 'Contact your local government office for guidance.',
      })),
      tip: 'Keep photocopies and digital scans of all documents. You can store them in DigiLocker (digilocker.gov.in).',
    };
  },
  z.object({ scheme_id: z.string(), language: z.string().optional() })
);

log.info('Government scheme tools registered', { count: 4 });
