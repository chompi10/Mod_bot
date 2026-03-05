/**
 * @file db/schema.ts — Database Types & Schema
 * 
 * WHY: TypeScript interfaces serve as our "single source of truth" for
 * data shapes. Every database operation, API response, and memory entry
 * references these types. This catches bugs at compile-time rather than
 * runtime (e.g., forgetting to store a user's language preference).
 * 
 * PATTERN: "Domain-Driven Design" — types model the real-world domain
 * (patients, appointments, schemes) rather than technical concerns.
 */

// ─── Core User ─────────────────────────────────────────────────
export interface User {
  /** WhatsApp ID (phone number format: whatsapp:+91XXXXXXXXXX) */
  whatsapp_id: string;
  /** User's display name (may be updated over time) */
  name: string;
  /** GPS location for emergency services and hospital lookup */
  location: { lat: number; lng: number } | null;
  /** Preferred language — detected automatically, can be overridden */
  language: 'tamil' | 'hindi' | 'english';
  /** People to contact in emergencies */
  emergency_contacts: EmergencyContact[];
  created_at: Date;
  updated_at: Date;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;  // e.g., "mother", "spouse", "friend"
}

// ─── Health Records ────────────────────────────────────────────
/**
 * WHY: Storing health records allows the bot to provide personalized
 * advice (e.g., "Given your diabetes, I'd suggest..." or "You're
 * allergic to penicillin, so let me recommend alternatives").
 * 
 * PRIVACY NOTE: This data is encrypted at rest and NEVER shared
 * without explicit user consent. See MEMORY.md access rules.
 */
export interface HealthRecord {
  user_id: string;
  /** Past conditions: ["diabetes type 2", "hypertension"] */
  medical_history: string[];
  /** Drug/food allergies: ["penicillin", "peanuts"] */
  allergies: string[];
  /** Current medications with dosage info */
  current_medications: Medication[];
  /** Booked and past appointments */
  appointments: Appointment[];
  /** BMI, blood group, etc. */
  vitals: Record<string, string>;
  last_updated: Date;
}

export interface Medication {
  name: string;
  dosage: string;          // e.g., "500mg"
  frequency: string;       // e.g., "twice daily"
  /** When the user should be reminded (cron expression) */
  reminder_cron?: string;
  start_date: Date;
  end_date?: Date;
}

export interface Appointment {
  id: string;
  hospital_name: string;
  doctor_name: string;
  specialty: string;
  date: Date;
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  notes?: string;
}

// ─── Conversations ─────────────────────────────────────────────
/**
 * WHY: Storing conversations enables:
 * 1. Multi-turn context (the bot remembers what you said 5 messages ago)
 * 2. RAG indexing (past conversations become searchable knowledge)
 * 3. Audit trail (especially important for health advice)
 */
export interface Conversation {
  session_id: string;
  user_id: string;
  messages: Message[];
  /** Which agent is handling this conversation */
  active_agent: 'health' | 'scheme' | 'education' | 'emergency' | 'general';
  created_at: Date;
  last_activity: Date;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Detected language of this specific message */
  language: 'tamil' | 'hindi' | 'english';
  /** Optional media attachments */
  media?: MediaAttachment;
  timestamp: Date;
  /** Metadata: tool calls made, tokens used, etc. */
  metadata?: Record<string, unknown>;
}

export interface MediaAttachment {
  type: 'image' | 'audio' | 'document' | 'video';
  url: string;
  /** Transcribed text (for voice messages) */
  transcription?: string;
  mime_type: string;
}

// ─── Memory Entries ────────────────────────────────────────────
/**
 * WHY: Memory entries are the structured form of what gets written
 * to MEMORY.md and daily log files. They're also used for RAG indexing.
 * 
 * The `category` field enables filtered recall — when a user asks about
 * their medications, we search only 'health' category memories.
 */
export interface MemoryEntry {
  id: string;
  user_id: string;
  content: string;
  category: 'health' | 'preference' | 'reminder' | 'scheme' | 'education' | 'general';
  /** Source: which conversation/event created this memory */
  source: string;
  created_at: Date;
  /** Relevance decays over time; recent memories score higher */
  relevance_score?: number;
  /** Vector embedding for semantic search */
  embedding?: number[];
}

// ─── Government Schemes ────────────────────────────────────────
export interface GovernmentScheme {
  id: string;
  name: string;
  /** Multi-lingual descriptions */
  description: Record<string, string>;
  /** Eligibility criteria as structured rules */
  eligibility: EligibilityRule[];
  /** Documents needed to apply */
  required_documents: string[];
  /** How to apply — step-by-step */
  application_steps: string[];
  /** Application deadline, if any */
  deadline?: Date;
  /** Category: health, education, housing, etc. */
  category: string;
  /** Government portal URL */
  portal_url?: string;
}

export interface EligibilityRule {
  field: string;      // e.g., "annual_income", "age", "gender"
  operator: 'lt' | 'gt' | 'eq' | 'in' | 'between';
  value: unknown;     // e.g., 100000, "female", [18, 60]
  description: string;
}

export interface SchemeApplication {
  id: string;
  user_id: string;
  scheme_id: string;
  status: 'draft' | 'pending' | 'submitted' | 'approved' | 'rejected';
  /** Uploaded document references */
  documents: DocumentRef[];
  application_date: Date;
  last_updated: Date;
  /** Tracking ID from the government portal */
  tracking_id?: string;
}

export interface DocumentRef {
  name: string;
  type: string;         // e.g., "aadhaar", "income_certificate"
  url: string;          // Storage URL
  verified: boolean;
  uploaded_at: Date;
}

// ─── Tool Definitions (MCP Protocol) ───────────────────────────
/**
 * WHY: MCP (Model Context Protocol) defines a standard way for LLMs
 * to discover and invoke tools. This interface matches the MCP spec
 * so our tools are compatible with any MCP-supporting LLM.
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input parameters */
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      required?: boolean;
    }>;
    required: string[];
  };
}

export interface MCPToolResult {
  tool_name: string;
  success: boolean;
  result: unknown;
  error?: string;
  /** How long the tool took to execute (for monitoring) */
  duration_ms: number;
}

// ─── Urgency Classification ────────────────────────────────────
/**
 * WHY: The health triage system classifies urgency into three levels.
 * This directly affects the bot's behavior:
 * - EMERGENCY: Immediately show emergency numbers, skip appointment flow
 * - URGENT: Prioritize same-day appointments, suggest ER if needed
 * - ROUTINE: Normal appointment booking flow
 */
export type UrgencyLevel = 'emergency' | 'urgent' | 'routine';

export interface TriageResult {
  urgency: UrgencyLevel;
  /** Confidence 0-1 in the urgency classification */
  confidence: number;
  /** Suggested medical specialty */
  recommended_specialty: string;
  /** Key symptoms identified */
  symptoms: string[];
  /** Advice to give the user immediately */
  immediate_advice: string;
  /** Disclaimer — always included */
  disclaimer: string;
}
