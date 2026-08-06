// src/pages/MerchantForm.tsx
import { useState } from 'react';
import { merchantApi } from '../api/merchant.api';
import type { MerchantFormData } from '../types/merchant.types';

interface MerchantFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  initialData?: Partial<MerchantFormData>;
}

export const MerchantForm = ({ 
  onSuccess, 
  onCancel, 
  initialData 
}: MerchantFormProps) => {
  const [formData, setFormData] = useState<MerchantFormData>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    category: initialData?.category || '',
    address: initialData?.address || '',
    phone: initialData?.phone || '',
    email: initialData?.email || '',
    // HAPUS isOpen
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name || formData.name.length < 3) {
      newErrors.name = 'Nama merchant minimal 3 karakter';
    }
    if (!formData.category) {
      newErrors.category = 'Kategori wajib diisi';
    }
    if (!formData.address) {
      newErrors.address = 'Alamat wajib diisi';
    }
    if (formData.email && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(formData.email)) {
      newErrors.email = 'Format email tidak valid';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) {
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      const response = await merchantApi.register(formData);
      
      console.log('✅ Merchant registered:', response.data); // ← FIX: response.data

      setFormData({
        name: '',
        description: '',
        category: '',
        address: '',
        phone: '',
        email: '',
        // HAPUS isOpen
      });

      if (onSuccess) {
        onSuccess();
      }
      
      alert('Merchant berhasil didaftarkan!');
    } catch (err: any) {
      console.error('❌ Error registering merchant:', err);
      setSubmitError(err.response?.data?.message || 'Gagal mendaftarkan merchant');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {submitError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {submitError}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[#A5C9B8] mb-1">
          Nama Merchant *
        </label>
        <input
          name="name"
          value={formData.name}
          onChange={handleChange}
          className={`w-full bg-[#06170E] border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00E575] transition-colors ${
            errors.name ? 'border-red-500' : 'border-[#23583E]'
          }`}
          placeholder="Masukkan nama merchant"
        />
        {errors.name && (
          <p className="text-red-400 text-xs mt-1">{errors.name}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[#A5C9B8] mb-1">
          Deskripsi
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={3}
          className="w-full bg-[#06170E] border border-[#23583E] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00E575] transition-colors resize-none"
          placeholder="Deskripsi merchant"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#A5C9B8] mb-1">
          Kategori *
        </label>
        <input
          name="category"
          value={formData.category}
          onChange={handleChange}
          className={`w-full bg-[#06170E] border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00E575] transition-colors ${
            errors.category ? 'border-red-500' : 'border-[#23583E]'
          }`}
          placeholder="Contoh: Warung, Apotek, Toko"
        />
        {errors.category && (
          <p className="text-red-400 text-xs mt-1">{errors.category}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[#A5C9B8] mb-1">
          Alamat *
        </label>
        <input
          name="address"
          value={formData.address}
          onChange={handleChange}
          className={`w-full bg-[#06170E] border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00E575] transition-colors ${
            errors.address ? 'border-red-500' : 'border-[#23583E]'
          }`}
          placeholder="Alamat lengkap merchant"
        />
        {errors.address && (
          <p className="text-red-400 text-xs mt-1">{errors.address}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-[#A5C9B8] mb-1">
          Nomor Telepon
        </label>
        <input
          name="phone"
          value={formData.phone}
          onChange={handleChange}
          className="w-full bg-[#06170E] border border-[#23583E] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00E575] transition-colors"
          placeholder="Contoh: 08123456789"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#A5C9B8] mb-1">
          Email
        </label>
        <input
          name="email"
          value={formData.email}
          onChange={handleChange}
          className={`w-full bg-[#06170E] border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-[#00E575] transition-colors ${
            errors.email ? 'border-red-500' : 'border-[#23583E]'
          }`}
          placeholder="email@example.com"
        />
        {errors.email && (
          <p className="text-red-400 text-xs mt-1">{errors.email}</p>
        )}
      </div>

      {/* HAPUS checkbox isOpen */}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-[#00E575] text-[#071F14] font-bold py-2.5 px-4 rounded-lg hover:bg-[#00ff80] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Mendaftarkan...' : 'Daftarkan Merchant'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-[#23583E] text-white font-bold py-2.5 px-4 rounded-lg hover:bg-[#2d6d4d] transition-colors"
          >
            Batal
          </button>
        )}
      </div>
    </form>
  );
};

export default MerchantForm;