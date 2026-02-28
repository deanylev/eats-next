import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const data = await getCmsData();

  return <PublicEatsPage restaurants={data.restaurants} />;
}
