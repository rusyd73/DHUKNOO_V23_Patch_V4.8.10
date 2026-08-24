import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah } from '@obama/shared-utils';
import { WalletAPI } from '../../api';

export function WithdrawalPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'BANK_TRANSFER' | 'EWALLET'>('BANK_TRANSFER');
  const [provider, setProvider] = useState('');
  const [account, setAccount] = useState('');
  const [name, setName] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['myWithdrawals'], queryFn: WalletAPI.getMyWithdrawalRequests });
  const summary = data?.data;
  const mutation = useMutation({
    mutationFn: WalletAPI.requestWithdrawal,
    onSuccess: () => { setAmount(''); setIsFormOpen(false); queryClient.invalidateQueries({ queryKey: ['myWithdrawals'] }); queryClient.invalidateQueries({ queryKey: ['driverProfile'] }); },
  });
  const requests = summary?.requests || [];
  const visibleRequests = isHistoryOpen ? requests.slice(0, 5) : requests.slice(0, 1);
  return (
    <div className="bg-[#06170E] border border-[#23583E] rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex justify-between gap-3">
        <div><p className="text-xs font-black text-[#00E575]">Pencairan Penghasilan</p><p className="text-[10px] text-[#A5C9B8]">Saldo ditahan lalu ditransfer Admin ke tujuan Anda. Mode otomatis akan aktif setelah gateway tersedia.</p></div>
        <div className="text-right"><p className="text-[9px] text-[#A5C9B8]">Dapat dicairkan</p><p className="text-sm font-black text-[#FFD700]">{formatRupiah(Number(summary?.availableAmount || 0))}</p></div>
      </div>
      <button type="button" onClick={() => setIsFormOpen((open) => !open)} className="w-full bg-[#00E575]/10 border border-[#00E575]/40 text-[#00E575] rounded-xl py-2 text-xs font-black">
        {isFormOpen ? 'Tutup Form Pencairan' : 'Buka Form Pencairan'}
      </button>
      {isFormOpen && (
        <form className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'} gap-2`} onSubmit={(e) => { e.preventDefault(); mutation.mutate({ amount: Number(amount), method, destinationProvider: provider, destinationAccount: account, destinationName: name }); }}>
          <input required type="number" min="10000" max="5000000" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Nominal (min. Rp10.000)" className="bg-[#0D2E1F] border border-[#23583E] rounded-lg p-2 text-xs text-white" />
          <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="bg-[#0D2E1F] border border-[#23583E] rounded-lg p-2 text-xs text-white"><option value="BANK_TRANSFER">Transfer Bank</option><option value="EWALLET">E-Wallet</option></select>
          <input required value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Nama bank / e-wallet" className="bg-[#0D2E1F] border border-[#23583E] rounded-lg p-2 text-xs text-white" />
          <input required minLength={5} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Nomor rekening / e-wallet" className="bg-[#0D2E1F] border border-[#23583E] rounded-lg p-2 text-xs text-white" />
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama pemilik rekening" className="bg-[#0D2E1F] border border-[#23583E] rounded-lg p-2 text-xs text-white" />
          <button disabled={mutation.isPending} className="bg-[#00E575] text-[#06170E] rounded-lg p-2 text-xs font-black disabled:opacity-50">{mutation.isPending ? 'Mengajukan...' : 'Ajukan Pencairan'}</button>
        </form>
      )}
      {mutation.isError && <p className="text-[10px] text-red-400">{(mutation.error as any)?.response?.data?.error || 'Gagal mengajukan pencairan.'}</p>}
      {mutation.isSuccess && <p className="text-[10px] text-[#00E575]">Pengajuan diterima dan menunggu transfer Admin.</p>}
      {visibleRequests.map((item: any) => <div key={item.id} className="flex justify-between text-[10px] border-t border-[#23583E]/60 pt-2"><span>{formatRupiah(Number(item.amount))} · {item.destinationProvider}</span><span className="font-bold text-[#FFD700]">{item.status.replaceAll('_', ' ')}</span></div>)}
      {requests.length > 1 && <button type="button" onClick={() => setIsHistoryOpen((open) => !open)} className="text-[10px] text-[#A5C9B8] hover:text-[#00E575]">{isHistoryOpen ? 'Sembunyikan riwayat' : `Lihat riwayat (${requests.length})`}</button>}
    </div>
  );
}
