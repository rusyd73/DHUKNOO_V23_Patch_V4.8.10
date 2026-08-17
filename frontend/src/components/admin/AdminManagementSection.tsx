import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminAPI } from '../../api';
import { ShieldPlus, ShieldCheck, UserX, Eye, EyeOff, RefreshCw } from 'lucide-react';

export default function AdminManagementSection({ triggerToast }: { triggerToast: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [reason, setReason] = useState('Administrator tidak lagi aktif');

  const adminsQuery = useQuery({
    queryKey: ['adminManagement'],
    queryFn: AdminAPI.getAdmins,
    staleTime: 15_000,
  });

  const createAdminMutation = useMutation({
    mutationFn: () => AdminAPI.createAdmin({ email, password, fullName }),
    onSuccess: (res: any) => {
      triggerToast(res?.message || 'Admin baru berhasil didaftarkan.');
      setFullName(''); setEmail(''); setPassword(''); setConfirmPassword('');
      queryClient.invalidateQueries({ queryKey: ['adminManagement'] });
    },
    onError: (err: any) => {
      triggerToast(err?.response?.data?.error || err?.message || 'Gagal mendaftarkan admin baru.');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (adminId: string) => AdminAPI.deactivateAdmin(adminId, reason),
    onSuccess: (res: any) => {
      triggerToast(res?.message || 'Akses admin berhasil dinonaktifkan.');
      queryClient.invalidateQueries({ queryKey: ['adminManagement'] });
    },
    onError: (err: any) => {
      triggerToast(err?.response?.data?.error || err?.message || 'Gagal menonaktifkan admin.');
    },
  });

  useEffect(() => {
    if (adminsQuery.isError) {
      triggerToast('Gagal memuat daftar administrator.');
    }
  }, [adminsQuery.isError, triggerToast]);

  const isSuperAdmin = Boolean(adminsQuery.data?.isSuperAdmin);
  const admins = adminsQuery.data?.admins || [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    if (password !== confirmPassword) return triggerToast('Konfirmasi password tidak sama.');
    if (password.length < 8) return triggerToast('Password admin minimal 8 karakter.');
    createAdminMutation.mutate();
  };

  const handleDeactivate = (admin: any) => {
    if (!isSuperAdmin || admin.isSuperAdmin) return;
    const ok = window.confirm(`Nonaktifkan akses admin ${admin.fullName} (${admin.email})?`);
    if (ok) deactivateMutation.mutate(admin.id);
  };

  return (
    <section className="bg-[#0D2E1F] border border-[#23583E] p-6 rounded-3xl flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-[#00E575]/10 border border-[#00E575]/30 text-[#00E575]">
            {isSuperAdmin ? <ShieldCheck className="w-5 h-5" /> : <ShieldPlus className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-lg font-black text-[#00E575]">Kelola Administrator</h3>
            <p className="text-[10px] text-[#A5C9B8] mt-0.5">
              {isSuperAdmin
                ? 'Anda adalah SUPER ADMIN. Anda dapat mendaftarkan admin baru dan menonaktifkan admin yang sudah tidak aktif.'
                : 'Anda adalah ADMIN BIASA. Anda dapat melihat daftar administrator, tetapi tidak dapat menambah atau menonaktifkan admin.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => adminsQuery.refetch()}
          className="p-2 rounded-xl bg-[#06170E] border border-[#23583E] text-[#A5C9B8] hover:text-[#00E575]"
          title="Segarkan daftar administrator"
        >
          <RefreshCw className={`w-4 h-4 ${adminsQuery.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-[#06170E] border border-[#23583E] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#23583E] flex justify-between items-center">
          <span className="text-xs font-black text-white">Daftar Administrator</span>
          <span className="text-[9px] text-[#A5C9B8]">{admins.length} akun</span>
        </div>
        <div className="divide-y divide-[#23583E]/50">
          {admins.map((admin: any) => (
            <div key={admin.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-white">{admin.fullName}</span>
                  {admin.isSuperAdmin && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-[#FFD700]/15 text-[#FFD700]">SUPER ADMIN</span>}
                  {!admin.isActive && <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">NONAKTIF</span>}
                </div>
                <div className="text-[9px] text-[#A5C9B8] truncate">{admin.email}</div>
              </div>
              {isSuperAdmin && admin.isActive && !admin.isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => handleDeactivate(admin)}
                  disabled={deactivateMutation.isPending}
                  className="shrink-0 inline-flex items-center gap-1 bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 px-2.5 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50"
                >
                  <UserX className="w-3.5 h-3.5" /> Nonaktifkan
                </button>
              )}
            </div>
          ))}
          {!adminsQuery.isLoading && admins.length === 0 && (
            <div className="p-5 text-center text-[10px] text-[#A5C9B8]/60">Belum ada administrator.</div>
          )}
        </div>
      </div>

      {isSuperAdmin && (
        <>
          <div className="border-t border-[#23583E]/60 pt-4">
            <h4 className="text-xs font-black text-[#FFD700] mb-3">Daftarkan Admin Biasa</h4>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={3} placeholder="Nama lengkap admin" className="bg-[#06170E] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Email admin" className="bg-[#06170E] border border-[#23583E] rounded-xl px-3 py-2.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]" />
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="Password admin (min. 8 karakter)" className="w-full bg-[#06170E] border border-[#23583E] rounded-xl px-3 py-2.5 pr-10 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A5C9B8]">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
              <div className="relative">
                <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} placeholder="Ulangi password admin" className="w-full bg-[#06170E] border border-[#23583E] rounded-xl px-3 py-2.5 pr-10 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#00E575]" />
                <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A5C9B8]">{showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
              <div className="md:col-span-2 flex justify-end pt-1">
                <button type="submit" disabled={createAdminMutation.isPending || !fullName || !email || !password || !confirmPassword} className="inline-flex items-center gap-2 bg-[#00E575] hover:bg-[#00ff80] disabled:opacity-50 text-[#06170E] font-black text-xs px-5 py-2.5 rounded-xl">
                  <ShieldPlus className="w-4 h-4" />
                  {createAdminMutation.isPending ? 'Mendaftarkan...' : 'Daftarkan Admin Biasa'}
                </button>
              </div>
            </form>
          </div>

          <div className="border-t border-[#23583E]/60 pt-4">
            <label className="text-[9px] text-[#A5C9B8]">Alasan default penonaktifan admin</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} className="mt-1 w-full bg-[#06170E] border border-[#23583E] rounded-xl px-3 py-2 text-[10px] text-white focus:outline-none focus:border-[#00E575]" />
          </div>
        </>
      )}
    </section>
  );
}
