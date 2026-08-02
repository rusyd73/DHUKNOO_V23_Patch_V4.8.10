import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, ShieldCheck, Phone } from 'lucide-react';
import { socket, joinRoom } from '../../services/socket';
import { OrderAPI } from '../../api/order.api';
import { InAppVoipCall } from './InAppVoipCall';

interface OrderChatBoxProps {
  orderId: string;
  currentUserId: string;
  currentUserRole: 'CUSTOMER' | 'DRIVER' | string;
  otherPartyName?: string;
  // BARU: nomor telepon lawan bicara — dipakai tombol "Telepon" di header
  // chat. Sengaja diambil dari props (bukan fetch terpisah) supaya otomatis
  // ikut ter-gerbang oleh syarat yang sama dengan tampilnya chat ini sendiri
  // (order harus sudah accepted, customer & driver sudah saling terhubung).
  otherPartyPhone?: string | null;
}

export function OrderChatBox({
  orderId,
  currentUserId,
  currentUserRole,
  otherPartyPhone,
  otherPartyName,
}: OrderChatBoxProps) {
  const [messages, setMessages] = useState<Array<{ sender: string; senderRole: string; message: string; sentAt: string }>>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // PERBAIKAN: sebelumnya chat cuma relay socket murni (in-memory), tidak
  // pernah disimpan — begitu salah satu pihak refresh/tutup layar, seluruh
  // riwayat percakapan hilang (kelihatan seperti "chat tidak dua arah").
  // Sekarang riwayatnya dimuat dari backend dulu saat komponen ini mount.
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    OrderAPI.getChatHistory(orderId)
      .then((history: any[]) => {
        if (cancelled) return;
        setMessages(
          history.length > 0
            ? history
            : [
                {
                  sender: 'system',
                  senderRole: 'SYSTEM',
                  message: `Ruang obrolan interaktif terhubung. Komunikasi aman langsung antar aplikasi.`,
                  sentAt: new Date().toISOString(),
                },
              ]
        );
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([
          {
            sender: 'system',
            senderRole: 'SYSTEM',
            message: `Ruang obrolan interaktif terhubung. Komunikasi aman langsung antar aplikasi.`,
            sentAt: new Date().toISOString(),
          },
        ]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    const roomId = `order_${orderId}`;
    joinRoom(roomId).catch((err) => console.log('Chat room join error:', err));

    const handleNewMessage = (data: { orderId: string; sender: string; senderRole: string; message: string; sentAt: string }) => {
      if (data.orderId === orderId) {
        setMessages((prev) => [
          ...prev,
          {
            sender: data.sender,
            senderRole: data.senderRole,
            message: data.message,
            sentAt: data.sentAt || new Date().toISOString(),
          },
        ]);
      }
    };

    socket.on('new_chat_message', handleNewMessage);
    return () => {
      socket.off('new_chat_message', handleNewMessage);
    };
  }, [orderId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const msg = inputText.trim();
    setInputText('');

    socket.emit('send_chat_message', {
      orderId,
      sender: currentUserId,
      message: msg,
    });
  };

  const quickChips =
    currentUserRole === 'DRIVER'
      ? ['Saya sudah di lokasi penjemputan', 'Siap meluncur kak!', 'Posisi tepatnya di sebelah mana ya?', 'Sudah dekat titik lokasi']
      : ['Saya sudah di titik jemput pak', 'Mohon ditunggu ya pak', 'Ciri-ciri helm/kendaraan apa pak?', 'Terima kasih pak'];

  return (
    <div className="bg-[#06170E] border border-[#23583E] rounded-2xl p-3.5 flex flex-col gap-2.5 shadow-md">
      <div className="flex items-center justify-between border-b border-[#23583E] pb-2 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#00E575]">
          <MessageCircle className="w-4 h-4 text-[#00E575]" />
          <span>Kolom Chat Interaktif {otherPartyName ? `(${otherPartyName})` : ''}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* BARU: FITUR TELEPON IN-APP VOIP INTERAKTIF */}
          <InAppVoipCall
            orderId={orderId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            otherPartyName={otherPartyName}
            otherPartyPhone={otherPartyPhone}
          />

          {/* Fallback Dialing lewat Handphone */}
          {otherPartyPhone && (
            <a
              href={`tel:${otherPartyPhone}`}
              title={`Telepon GSM ${otherPartyName || 'lawan bicara'}`}
              className="text-[9px] bg-[#FFD700]/15 hover:bg-[#FFD700]/25 text-[#FFD700] font-bold px-2 py-0.5 rounded-full border border-[#FFD700]/30 flex items-center gap-1 transition-all"
            >
              <Phone className="w-3 h-3" /> Dial HP
            </a>
          )}
          <span className="text-[9px] bg-[#00E575]/20 text-[#00E575] font-bold px-2 py-0.5 rounded-full border border-[#00E575]/30 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> In-App Direct
          </span>
        </div>
      </div>

      {/* Bubble Message List */}
      <div className="max-h-48 min-h-[100px] overflow-y-auto flex flex-col gap-2 pr-1 text-xs">
        {messages.map((m, idx) => {
          const isMe = m.sender === currentUserId || (m.senderRole && m.senderRole === currentUserRole);
          const isSystem = m.senderRole === 'SYSTEM';

          if (isSystem) {
            return (
              <div key={idx} className="text-center text-[9px] text-[#A5C9B8]/70 italic my-0.5 bg-[#0D2E1F]/60 py-1.5 px-3 rounded-xl border border-[#23583E]/40">
                {m.message}
              </div>
            );
          }

          return (
            <div key={idx} className={`flex flex-col max-w-[85%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
              <div
                className={`px-3 py-2 rounded-2xl text-[11px] leading-relaxed break-words font-medium shadow-sm ${
                  isMe
                    ? 'bg-[#00E575] text-[#06170E] rounded-br-none font-semibold'
                    : 'bg-[#0D2E1F] text-white border border-[#23583E] rounded-bl-none'
                }`}
              >
                {m.message}
              </div>
              <span className="text-[8px] text-[#A5C9B8]/60 mt-0.5 px-1 font-mono">
                {isMe ? 'Anda' : m.senderRole === 'DRIVER' ? 'Mitra Driver' : 'Customer'} •{' '}
                {new Date(m.sentAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {quickChips.map((chip, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              socket.emit('send_chat_message', { orderId, sender: currentUserId, message: chip });
            }}
            className="text-[9px] bg-[#0D2E1F] hover:bg-[#23583E] text-[#A5C9B8] hover:text-white px-2.5 py-1 rounded-full whitespace-nowrap border border-[#23583E] transition-all font-medium"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Ketik pesan untuk ${currentUserRole === 'DRIVER' ? 'Customer' : 'Driver'}...`}
          className="flex-1 bg-[#0D2E1F] border border-[#23583E] text-white text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-[#00E575] placeholder:text-gray-500"
        />
        <button
          type="submit"
          className="bg-[#00E575] hover:bg-[#00ff80] text-[#06170E] font-black text-xs px-3.5 py-2 rounded-xl flex items-center justify-center gap-1 transition-all shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Kirim</span>
        </button>
      </form>
    </div>
  );
}
