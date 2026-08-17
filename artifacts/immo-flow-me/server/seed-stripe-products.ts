import { getUncachableStripeClient } from './stripeClient';

async function seedProducts() {
  console.log('Creating Stripe products and prices...');
  
  const stripe = await getUncachableStripeClient();

  // Check if products already exist
  const existingProducts = await stripe.products.search({ 
    query: "name:'ImmoFlowMe Starter'" 
  });
  
  if (existingProducts.data.length > 0) {
    console.log('Products already exist, skipping...');
    const prices = await stripe.prices.list({ limit: 10, active: true });
    console.log('\nExisting prices:');
    for (const price of prices.data) {
      const product = await stripe.products.retrieve(price.product as string);
      console.log(`  ${product.name}: ${price.id} - €${(price.unit_amount || 0) / 100}/${price.recurring?.interval || 'one-time'}`);
    }
    return;
  }

  // Create Starter Plan
  const starterProduct = await stripe.products.create({
    name: 'ImmoFlowMe Starter',
    description: 'Für kleine bis mittlere Hausverwaltungen. Bis zu 50 Immobilien, unbegrenzte Mieter.',
    metadata: {
      tier: 'starter',
      features: 'sepa_export,documents,reports,settlements',
    },
  });
  console.log('Created Starter product:', starterProduct.id);

  const starterPrice = await stripe.prices.create({
    product: starterProduct.id,
    unit_amount: 3900, // €39.00
    currency: 'eur',
    recurring: { interval: 'month' },
    metadata: { tier: 'starter' },
  });
  console.log('Created Starter price:', starterPrice.id);

  // Create Pro Plan
  const proProduct = await stripe.products.create({
    name: 'ImmoFlowMe Pro',
    description: 'Für professionelle Hausverwaltungen mit Automatisierung. Unbegrenzte Immobilien und Mieter.',
    metadata: {
      tier: 'pro',
      features: 'automation,api_access,priority_support,all_starter_features',
    },
  });
  console.log('Created Pro product:', proProduct.id);

  const proPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 29900, // €299.00
    currency: 'eur',
    recurring: { interval: 'month' },
    metadata: { tier: 'pro' },
  });
  console.log('Created Pro price:', proPrice.id);

  // Create Enterprise Plan (for organizations)
  const enterpriseProduct = await stripe.products.create({
    name: 'ImmoFlowMe Enterprise',
    description: 'Enterprise-Lösung mit API-Zugang und Priority Support.',
    metadata: {
      tier: 'enterprise',
      features: 'unlimited,api,priority_support,custom_integrations',
    },
  });
  console.log('Created Enterprise product:', enterpriseProduct.id);

  const enterprisePrice = await stripe.prices.create({
    product: enterpriseProduct.id,
    unit_amount: 39900, // €399.00
    currency: 'eur',
    recurring: { interval: 'month' },
    metadata: { tier: 'enterprise' },
  });
  console.log('Created Enterprise price:', enterprisePrice.id);

  console.log('\n=== PRICE IDS FOR CHECKOUT ===');
  console.log(`STRIPE_USER_PRICE_STARTER=${starterPrice.id}`);
  console.log(`STRIPE_USER_PRICE_PRO=${proPrice.id}`);
  console.log(`STRIPE_PRICE_ENTERPRISE_MONTHLY=${enterprisePrice.id}`);
  console.log('\nProducts and prices created successfully!');
}

seedProducts().catch(console.error);
