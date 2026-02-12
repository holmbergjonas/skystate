export interface TierFeature {
  text: string;
}

export interface TierDefinition {
  id: string;
  name: string;
  price: string;
  priceSuffix: string | null;
  priceNote: string | null;
  features: TierFeature[];
  limits: {
    projects: string;
    environments: string;
    storage: string;
    retention: string;
    apiRequests: string;
  };
}

export const TIERS: TierDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    priceSuffix: null,
    priceNote: 'Free forever',
    features: [
      { text: '1 project' },
      { text: '2 environments' },
      { text: '500 KB storage' },
      { text: '30-day version history' },
      { text: '200 API requests/mo' },
    ],
    limits: {
      projects: '1 project',
      environments: '2 per project',
      storage: '500 KB',
      retention: '30 days',
      apiRequests: '200',
    },
  },
  {
    id: 'hobby',
    name: 'Hobby',
    price: '$5',
    priceSuffix: '/month',
    priceNote: 'Everything in Free, plus:',
    features: [
      { text: '3 projects' },
      { text: 'Unlimited environments' },
      { text: '10 MB storage' },
      { text: '90-day version history' },
      { text: '2,000 API requests/mo' },
    ],
    limits: {
      projects: '3 projects',
      environments: 'Unlimited',
      storage: '10 MB',
      retention: '90 days',
      apiRequests: '2,000',
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$15',
    priceSuffix: '/month',
    priceNote: 'Everything in Hobby, plus:',
    features: [
      { text: '10 projects' },
      { text: 'Unlimited environments' },
      { text: '100 MB storage' },
      { text: 'Unlimited version history' },
      { text: '20,000 API requests/mo' },
      { text: 'Resource boosters' },
    ],
    limits: {
      projects: '10 projects',
      environments: 'Unlimited',
      storage: '100 MB',
      retention: 'Unlimited',
      apiRequests: '20,000',
    },
  },
];
