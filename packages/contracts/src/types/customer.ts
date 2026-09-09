import type { Iso8601, RequestEnvelope, ResourceId, TenantId } from "./common.js";

export interface Customer {
  id: ResourceId;
  tenantId: TenantId;
  fullName: string;
  email: string | null;
  phone: string | null;
  taxId: string | null; // RFC
  createdAt: Iso8601;
}

export interface CustomerAddress {
  id: ResourceId;
  customerId: ResourceId;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: "MX";
  isDefault: boolean;
}

export interface CustomerConsent {
  id: ResourceId;
  customerId: ResourceId;
  scope: "WHATSAPP" | "MARKETING" | "DATA_PROCESSING";
  granted: boolean;
  grantedAt: Iso8601 | null;
  revokedAt: Iso8601 | null;
}

export type CustomerConsentResult = RequestEnvelope<CustomerConsent>;