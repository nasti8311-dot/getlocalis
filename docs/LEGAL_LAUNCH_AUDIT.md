# FiiViu – Romanian legal launch audit (working document)

**Status: NOT CLEARED FOR COMMERCIAL LAUNCH.** This is a repository and product-flow audit, not a legal opinion. No document can be certified “100% compliant” without verified company records, the actual payment/contract model, operational configuration and review by Romanian counsel.

## Facts visible in the repository
- The project describes FiiViu S.R.L. as an intermediary marketplace for experiences.
- Listed experience types include tours, food tours, karting, wellness/massage, nightlife, boat trips, day trips and individual airport transfers.
- The repository says experiences are booked and paid in full online and that no packages or combined services are sold in one booking.
- The repository itself says the company CUI, Trade Register number, full legal address and VAT status are still missing.
- The booking-management UI says refunds are initiated through Stripe after a successful cancellation; this needs to match the actual server-side refund process and customer-facing rules.
- The cancellation policy says the rules must be configured per experience, so it is not yet a complete operational policy.

## Blocking facts required from the business owner
1. Official company extract: exact registered company name, CUI, ONRC Trade Register number, registered office address (street, number, building/unit if applicable, sector, postal code, city), and current VAT status/VAT ID if applicable.
2. Confirm the contractual structure: who is the supplier and contracting party for each booking; whether FiiViu acts only as disclosed agent/intermediary; who issues the invoice/receipt; who is merchant of record; who sets prices and cancellation rules; who legally receives and settles customer funds.
3. Actual Stripe setup: Stripe Payments vs Stripe Connect, account type, charge type, destination/separate charges and transfers, refund and chargeback responsibility, payout timing, and which entity appears on the customer’s card statement.
4. Supplier onboarding: whether every provider is a business/trader, what happens if a provider is not a trader, and which identity, address, contact, registration, licensing, insurance and payout details are collected and verified before publication.
5. Actual cancellation matrix for each experience type, refund approval authority, processing steps, and realistic customer-facing timelines.
6. Exact services active in production: analytics, pixels, advertising, email provider(s), maps, payment integrations, cookie/local/session storage and any third-party embeds.
7. Tax/accounting confirmation for marketplace commissions, supplier payments, VAT and invoices from a Romanian accountant.

## Findings that must be resolved before launch

### A. Company identity and consumer information — BLOCKER
The legal notice, terms and privacy notice do not contain the complete official company identity. Romanian online-trader disclosure rules require accurate legal identity and registration information; do not guess or publish placeholders as if complete. ANPC Order 225/2023 specifically requires online operators to display company name, CUI, relevant register number, business address and applicable authorisations/licences.

### B. Intermediary status and consumer contract — BLOCKER
The wording “intermediary only” does not by itself determine legal responsibility. Terms, checkout, receipt/invoice, payment flow, provider page, customer emails and actual control over the experience must all tell the same story. State clearly before payment the identity and trader status of the actual experience provider; whether the customer’s service contract is with that provider and the separate role of FiiViu; who is responsible for performance, safety, complaints, cancellation and refunds; and the total price, all mandatory charges/taxes, payment timing and provider-specific terms. Do not use blanket liability exclusions or imply statutory consumer rights are waived.

### C. Consumer cancellation / withdrawal — BLOCKER
Do not state a blanket rule that every experience is non-refundable or that every booking is exempt from the 14-day withdrawal right. The exception for leisure services tied to a specific date or period must be assessed per service and correctly disclosed before the order. Other services may remain subject to statutory withdrawal rules. Cancellation rights promised in an offer must match the actual cancellation UI and backend. Refund timelines must distinguish statutory withdrawal refunds from contractual cancellations and provider cancellations.

### D. Online marketplace and DSA duties — BLOCKER
Where the service qualifies as an online platform enabling consumers to conclude distance contracts with traders, assess and implement applicable DSA marketplace duties, including trader traceability and the required pre-listing collection/self-certification, disclosure of trader identity, interface design and relevant notice/action and decision-reason procedures. The provider terms alone do not prove that the required controls exist in the product.

### E. Ranking and paid placement — VERIFY
The provider terms describe ranking factors and say paid prominence will be labelled. Verify that the live ranking actually uses those factors and that paid/promoted placement is clearly identified in the UI. Explain the main ranking parameters to consumers where required.

### F. Privacy notice and GDPR — BLOCKER
The privacy notice must describe the actual production data flows, controller identity, purposes and legal bases, recipients/processors, international transfers where relevant, retention periods or meaningful criteria, data-subject rights and complaint route. “Retained as long as necessary” plus an undocumented internal retention schedule is not enough for a robust notice. Identify which email provider is actually used; avoid “Resend and/or EmailJS” if only one or both are active. Confirm Cloudflare, Stripe, analytics, maps and all other integrations against deployed code and contracts.

### G. Cookies / terminal storage — BLOCKER
Audit the live site and legal pages for cookies, localStorage, sessionStorage, pixels and third-party embeds. The legal notice currently writes the language preference to localStorage; assess and disclose this accurately. Non-essential terminal storage/access must not run before valid consent where consent is required. The cookie policy exists only in Romanian and is not linked from the legal index; add a visible link and provide language versions appropriate to the site’s user-facing languages.

### H. Cancellation/refunds and operational consistency — BLOCKER
The current cancellation policy is generic and explicitly says each offer’s rules still need configuration. Define the per-offer policy, cancellation cut-offs, no-show rules, provider cancellation/weather handling, refund authority and customer communication. Ensure the “refund initiated through Stripe” message is shown only after the server actually accepts the cancellation and starts the correct refund flow. Do not promise a timeline the system cannot meet.

### I. Provider terms — BLOCKER
The provider terms are incomplete as an operational commercial agreement if the commission, payout timing, settlement/reconciliation, taxes/invoicing, reserves/chargebacks, provider documentation, service standards, safety/insurance, complaint cooperation and termination mechanics are not specified in the actual provider agreement or a clearly incorporated schedule. The current English and Romanian text should be checked for complete semantic parity with German.

### J. Regulated experience categories — BLOCKER BY CATEGORY
Before publishing each category, check the provider’s permits, qualifications, insurance and sector rules. In particular, day trips/tours and airport transfers can raise separate tourism, transport, consumer and insurance requirements. A statement that FiiViu is an intermediary does not remove obligations that apply to FiiViu’s own activities.

### K. Site presentation and document discoverability
The legal index currently omits the cookie policy and provider terms. Link all relevant consumer-facing policies clearly from the footer and checkout; keep provider-only terms separately discoverable in provider onboarding. Make sure terms are available before the customer places a binding order and the confirmation is delivered on a durable medium.

## Legal sources to validate during Romanian counsel review
- Romanian OUG 34/2014 on consumer rights in distance contracts, as amended.
- Romanian OUG 18/2026 and its effective-date provisions for amendments to consumer-protection rules (the amendments referred to in the current review apply from 27 September 2026).
- Romanian ANPC Order 225/2023 on information displayed by online operators.
- Romanian Law 506/2004 on privacy in electronic communications / terminal storage.
- GDPR, especially Articles 5, 6, 13, 28, 32 and 44–49 as applicable.
- Regulation (EU) 2022/2065 (Digital Services Act), especially Article 30 where applicable.
- Romanian Law 365/2002 on electronic commerce and Law 363/2007 on unfair commercial practices, as amended.

## Definition of done
Do not mark the legal set “final” until all owner facts above are confirmed, each blocking item is implemented in both documents and product flows, translations are checked for parity, automated checks pass, and Romanian counsel has reviewed the final version against the real business and tax model.
