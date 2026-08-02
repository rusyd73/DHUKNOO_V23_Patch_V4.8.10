/**
 * Formats a number into Indonesian Rupiah (IDR) currency format.
 * @param amount - The numeric balance/price to format
 */
export const formatRupiah = (amount: number): string => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

/**
 * Calculates the great-circle distance between two points on the Earth's surface
 * using the Haversine formula (returned in kilometers).
 */
export const calculateHaversineDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
      
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

/**
 * Formats date-time string into user-friendly locale format.
 */
export const formatDateTime = (dateStr: string): string => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch (e) {
    return dateStr;
  }
};

/**
 * Validates Indonesian phone numbers (starts with +62 or 08)
 */
export const isValidIndonesianPhoneNumber = (phone: string): boolean => {
  const regex = /^(?:\+62|62|0)8[1-9][0-9]{6,10}$/;
  return regex.test(phone.replace(/[\s-]/g, ''));
};
