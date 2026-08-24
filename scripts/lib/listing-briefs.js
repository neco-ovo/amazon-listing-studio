export function compileListingBrief({facts = {}, marketLanguage = [], rules = {}} = {}) {
  const publishableFacts = Object.fromEntries(
    Object.entries(facts)
      .filter(([, fact]) => fact?.publishable === true)
      .map(([id, fact]) => [id, structuredClone(fact)])
  );

  return {
    publishable_facts: publishableFacts,
    market_language: [...new Set(marketLanguage.filter(Boolean))],
    limits: structuredClone(rules?.limits ?? {}),
    fields: {
      title: {
        priority: ['product_identity', 'purchase_intent', 'key_differentiator', 'size_or_variant'],
        rule: 'lead_with_relevance_and_read_naturally'
      },
      item_highlights: {
        priority: ['purchase_intent', 'consumer_benefit', 'material_or_durability', 'mounting_surfaces'],
        rule: 'use_prime_search_and_conversion_space_for_why_buy'
      },
      bullets: {
        priority: ['buyer_outcome', 'supported_product_fact', 'proof_or_use_context'],
        heading_rule: 'consumer_benefit_not_raw_spec'
      },
      description: {
        priority: ['product_fit', 'natural_fact_synthesis', 'use_context'],
        rule: 'connect_material_performance_environment_and_mounting_in_that_order'
      },
      backend_search_terms: {
        strategy: 'complement_frontend',
        candidates: [...new Set(marketLanguage.filter(Boolean))],
        rule: 'add_relevant_buyer_language_not_already_covered_on_front'
      },
      product_details: {
        priority: ['confirmed_attributes', 'special_features'],
        rule: 'include_supported_upload_fields_without_marketing_invention'
      }
    },
    language_rules: [
      'combine_confirmed_facts_into_natural_consumer_language',
      'avoid_empty_conservative_phrasing',
      'keep_environment_performance_separate_from_mounting_surface',
      'do_not_add_compliance_claims_without_support'
    ]
  };
}
