import { NextResponse } from 'next/server';
import { createRestaurantRecord } from '@/lib/cms-write';
import { getDb } from '@/lib/db';
import { parseRestaurantFormData } from '@/lib/restaurant-form-data';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getCurrentAdminSession, resolveRequestTenant } from '@/lib/request-context';
import { assertValidRequestOrigin } from '@/lib/request-origin';

const getUserErrorText = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: string }).code ?? '');
    const constraint = String((error as { constraint?: string }).constraint ?? '');
    if (code === '23505' && constraint === 'restaurants_unique_active_city_name_idx') {
      return 'A restaurant with this name already exists in this city.';
    }
  }

  if (error && typeof error === 'object' && 'issues' in error) {
    const maybeIssues = (error as { issues?: Array<{ message?: string }> }).issues;
    if (maybeIssues && maybeIssues.length > 0) {
      return maybeIssues.map((issue) => issue.message ?? 'Validation error').join(' ');
    }
  }

  if (error instanceof Error && error.name === 'UserFacingError') {
    return error.message;
  }

  console.error('Failed to create restaurant inline', error);
  return 'Something went wrong. Please try again.';
};

export async function POST(request: Request): Promise<Response> {
  try {
    assertValidRequestOrigin({
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer')
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const tenant = await resolveRequestTenant();
  const session = await getCurrentAdminSession();
  if (!doesSessionMatchTenant(session, tenant)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form submission.' }, { status: 400 });
  }

  try {
    const restaurantId = await createRestaurantRecord(getDb(), tenant.id, parseRestaurantFormData(formData));
    return NextResponse.json({ restaurantId });
  } catch (error) {
    return NextResponse.json({ error: getUserErrorText(error) }, { status: 400 });
  }
}
