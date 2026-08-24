import React, { useMemo, useState } from 'react';
import { ArrowRight, Bike, CheckCircle2, ChevronRight, HeartHandshake, MapPin, PackageCheck, Send, ShieldCheck, Store, Users, WalletCards } from 'lucide-react';
import { BrandMark } from '../../components/common/BrandMark';

type Audience = 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'GENERAL';
type BetaAudience = Exclude<Audience, 'GENERAL'>;

type View = 'landing' | 'survey' | 'beta' | 'thanks';

const API_BASE = '/api/public';

function initialView(): View {
  const path = window.location.pathname.toLowerCase();
  if (path.startsWith('/survey')) return 'survey';
  if (path.startsWith('/beta')) return 'beta';
  return 'landing';
}

function navigate(view: View) {
  const path = view === 'landing' ? '/public' : view === 'thanks' ? '/public' : `/${view}`;
  window.history.pushState({}, '', path);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export default function PublicExperience() {
  const [view, setView] = useState<View>(initialView);
  const [thanksTitle, setThanksTitle] = useState('Terima kasih sudah ikut membangun DHUKNOO.');

  React.useEffect(() => {
    const onPop = () => setView(initialView());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 🆕 Bersihkan query parameter asing dari address bar (mis. utm_source
  // yang otomatis ditambahkan ChatGPT/platform lain ke link yang diklik
  // dari dalam percakapan mereka) -- supaya URL yang dilihat visitor
  // selalu rapi untuk dibagikan ulang, apapun jalur mereka sampai ke sini.
  // Satu-satunya parameter yang sengaja DIPERTAHANKAN adalah `src`, yang
  // memang dipakai sistem untuk campaign tracking (lihat docs/PUBLIC_BETA_MODULE.md).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const cleanSearch = src ? `?src=${encodeURIComponent(src)}` : '';
    if (window.location.search !== cleanSearch) {
      window.history.replaceState({}, '', `${window.location.pathname}${cleanSearch}`);
    }
  }, []);

  const go = (next: View) => {
    navigate(next);
    setView(next);
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#06170E] text-[#E4F3EC] selection:bg-[#22C55E] selection:text-[#06170E]">
      <PublicHeader go={go} />
      {view === 'landing' && <Landing go={go} />}
      {view === 'survey' && <Survey onDone={() => { setThanksTitle('Pendapat Anda sudah tercatat. Terima kasih sudah membantu arah pengembangan DHUKNOO.'); go('thanks'); }} />}
      {view === 'beta' && <BetaRegistration onDone={() => { setThanksTitle('Pendaftaran Public Beta berhasil. Kami akan menggunakan data ini untuk penyaringan gelombang uji publik.'); go('thanks'); }} />}
      {view === 'thanks' && <Thanks title={thanksTitle} go={go} />}
      <PublicFooter />
    </div>
  );
}

function PublicHeader({ go }: { go: (v: View) => void }) {
  return (
    <header className="sticky top-0 z-50 border-b border-[#23583E]/60 bg-[#06170E]/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl min-w-0 items-center justify-between gap-2 px-4 py-3 md:px-6">
        <button onClick={() => go('landing')} className="flex min-w-0 items-center gap-3 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#22C55E]/30 bg-[#103D27] p-2 text-[#22C55E]"><BrandMark className="h-full w-full" /></span>
          <span><b className="block tracking-tight text-white">DHUKNOO</b><small className="text-[#A5C9B8]">Batu · Malang Raya</small></span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => go('survey')} className="hidden rounded-xl border border-[#23583E] px-4 py-2 text-sm font-bold text-[#A5C9B8] hover:border-[#22C55E] hover:text-white sm:block">Isi Survey</button>
          <button onClick={() => go('beta')} className="shrink-0 whitespace-nowrap rounded-xl bg-[#22C55E] px-3 py-2 text-xs font-black sm:px-4 sm:text-sm text-[#05110A] hover:bg-[#16A34A]">Ikut Public Beta</button>
        </div>
      </div>
    </header>
  );
}

function Landing({ go }: { go: (v: View) => void }) {
  return <main>
    <section className="relative overflow-hidden border-b border-[#23583E]/40">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(34,197,94,0.16),transparent_34%),radial-gradient(circle_at_10%_80%,rgba(245,158,11,0.08),transparent_30%)]" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-[1.1fr_.9fr] md:px-6 md:py-24">
        <div className="flex flex-col justify-center">
          <span className="mb-5 w-fit rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 px-3 py-1 text-xs font-black uppercase tracking-[.16em] text-[#22C55E]">Platform lokal · Public Beta</span>
          <h1 className="max-w-4xl text-5xl font-black leading-[.95] tracking-[-.04em] text-white md:text-7xl">Katanya tidak bisa. <span className="text-[#F59E0B]">Kami mau buktikan bisa.</span></h1>
          <p className="mt-5 text-2xl font-black text-[#22C55E] md:text-3xl">Uji langsung, bukan cuma janji.</p>
          <p className="mt-6 max-w-2xl text-base leading-7 text-[#A5C9B8] md:text-lg">DHUKNOO dibangun dari Malang Raya dengan satu gagasan sederhana: harga tetap terjangkau bagi pengguna tanpa kehilangan penghargaan pada manusia yang bekerja di balik setiap perjalanan.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => go('survey')} className="flex items-center gap-2 rounded-2xl bg-[#22C55E] px-6 py-3.5 font-black text-[#05110A] shadow-xl shadow-green-950/30">Bantu lewat Survey <ArrowRight className="h-4 w-4" /></button>
            <button onClick={() => go('beta')} className="rounded-2xl border border-[#2C694C] bg-[#0B2318] px-6 py-3.5 font-black text-white">Daftar Public Beta</button>
          </div>
        </div>
        <div className="grid gap-3 self-center sm:grid-cols-2">
          <ValueCard icon={<WalletCards />} title="Terjangkau" text="Tarif dirancang masuk akal untuk dipakai sehari-hari, bukan hanya terasa murah ketika ada promo. Terjangkau bagi pengguna, dengan tetap menjaga nilai yang layak bagi mitra." />
          <ValueCard icon={<HeartHandshake />} title="Lebih manusiawi" text="Mitra adalah manusia yang membawa waktu, tenaga, kendaraan, tanggung jawab, keamanan, dan pelayanan — bukan sekadar titik di peta. Karena itu, keseimbangan antara harga bagi pengguna dan penghargaan kepada mitra menjadi bagian utama dari cara DHUKNOO dibangun." />
          <ValueCard icon={<ShieldCheck />} title="Lebih transparan" text="Nilai produk, perjalanan, bagian mitra dan platform dipisahkan sesuai fungsi masing-masing agar aliran nilai lebih mudah dipahami." />
          <ValueCard icon={<MapPin />} title="Lahir dari daerah" text="Dibangun, tidak untuk menyaingi yang sudah besar, tapi dibangun, diuji dan dikembangkan dari Batu–Malang Raya utamanya adalah untuk menghadirkan alternatif yang lebih manusiawi, lebih dekat, dengan kebutuhan mitra, merchant dan masyarakat (PODO KERJO E PODO OLEH E." />
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-16 md:px-6">
      <div className="mb-8 max-w-3xl"><span className="text-xs font-black uppercase tracking-[.18em] text-[#22C55E]">Satu ekosistem</span><h2 className="mt-2 text-3xl font-black text-white md:text-5xl">Murah tidak harus mengorbankan kualitas.</h2></div>
      <div className="grid gap-4 md:grid-cols-3">
        <AudienceCard icon={<Users />} title="Untuk Customer" points={['Ride & Car untuk mobilitas', 'SEND untuk pengiriman barang', 'Merchant untuk kebutuhan lokal', 'Tip sukarela langsung untuk mitra']} />
        <AudienceCard icon={<Bike />} title="Untuk Driver" points={['Order sesuai layanan & kendaraan', 'Status perjalanan yang jelas', 'Penghasilan dan deposit tercatat', 'Porsi mitra dijaga secara transparan']} />
        <AudienceCard icon={<Store />} title="Untuk Merchant" points={['Nilai produk tetap milik merchant', 'Delivery dipisahkan dari nilai produk', 'Ekosistem lokal dalam satu platform', 'Tidak perlu mengatur pembagian driver/platform']} />
      </div>
    </section>

    <section className="border-y border-[#23583E]/50 bg-[#081D14]">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div><span className="text-xs font-black uppercase tracking-[.18em] text-[#F59E0B]">DHUKNOO Transparency</span><h2 className="mt-2 text-3xl font-black text-white md:text-5xl">Ke mana uang transaksi Anda?</h2><p className="mt-4 max-w-xl leading-7 text-[#A5C9B8]">Kami tidak ingin sekadar berkata “lebih adil”. Prinsip aliran transaksi dibuat mudah dipahami: nilai produk untuk merchant, biaya perjalanan dibagi sesuai kontrak sistem, dan tip pengguna diarahkan kepada mitra driver.</p></div>
          <div className="rounded-3xl border border-[#2A6549] bg-[#06170E] p-5 shadow-2xl">
            <FlowBox label="CUSTOMER" value="Total pembayaran" strong />
            <FlowArrow />
            <div className="grid grid-cols-2 gap-3"><FlowBox label="PRODUK" value="→ Merchant" /><FlowBox label="PERJALANAN" value="→ Driver + Platform" /></div>
            <div className="mt-3"><FlowBox label="TIP (opsional)" value="→ Driver" accent /></div>
            <p className="mt-4 text-center text-xs text-[#729B87]">Persentase/nominal aktual mengikuti konfigurasi tarif yang berlaku pada transaksi.</p>
          </div>
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-5xl px-4 py-20 text-center md:px-6"><span className="text-xs font-black uppercase tracking-[.18em] text-[#22C55E]">Belum sempurna. Sengaja diuji.</span><h2 className="mx-auto mt-3 max-w-3xl text-4xl font-black text-white md:text-6xl">Jangan hanya menjadi penonton. Ikut tentukan bentuknya.</h2><p className="mx-auto mt-5 max-w-2xl leading-7 text-[#A5C9B8]">Public Beta dipakai untuk menguji bukan hanya kode, tetapi juga tarif, waktu tunggu, kenyamanan pengguna, kelayakan mitra, dan kebutuhan merchant di dunia nyata.</p><div className="mt-8 flex justify-center gap-3"><button onClick={() => go('survey')} className="rounded-2xl bg-[#22C55E] px-6 py-3.5 font-black text-[#05110A]">Isi Survey 2 Menit</button><button onClick={() => go('beta')} className="rounded-2xl border border-[#2C694C] px-6 py-3.5 font-black text-white">Saya Mau Menguji</button></div></section>
  </main>;
}

function Survey({ onDone }: { onDone: () => void }) {
  const [audience, setAudience] = useState<Audience>('CUSTOMER');
  const [answers, setAnswers] = useState({ usage: '', priority: '', fairPrice: '', waitTime: '', platformConcern: '', improvement: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labels = useMemo(() => audience === 'DRIVER' ? { usage: 'Seberapa sering Anda online sebagai driver?', fair: 'Penghasilan minimum seperti apa yang Anda anggap layak untuk perjalanan pendek?', concern: 'Apa kekhawatiran terbesar Anda sebagai mitra platform?' } : audience === 'MERCHANT' ? { usage: 'Seberapa sering usaha Anda menggunakan layanan delivery?', fair: 'Skema biaya seperti apa yang terasa wajar bagi merchant?', concern: 'Apa kekhawatiran terbesar merchant terhadap platform delivery?' } : { usage: 'Seberapa sering Anda menggunakan transportasi/delivery online?', fair: 'Berapa tarif yang menurut Anda masih terasa wajar untuk perjalanan pendek?', concern: 'Apa kekhawatiran terbesar Anda saat memakai aplikasi transportasi/delivery?' }, [audience]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!answers.usage || !answers.priority || !answers.fairPrice || !answers.waitTime || !answers.platformConcern || !answers.improvement) { setError('Mohon lengkapi seluruh pertanyaan sebelum mengirim.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/survey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience, answers, source: new URLSearchParams(window.location.search).get('src') || 'landing' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Survey belum dapat dikirim.');
      onDone();
    } catch (err: any) { setError(err.message || 'Terjadi kesalahan.'); } finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-16"><PublicTitle kicker="Survey Publik" title="Bantu kami menguji asumsi dengan kenyataan." text="Tidak perlu jawaban yang menyenangkan kami. Yang kami butuhkan justru jawaban yang jujur." /><form onSubmit={submit} className="mt-8 space-y-5"><Field label="Saya mengisi sebagai"><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{(['CUSTOMER','DRIVER','MERCHANT','GENERAL'] as Audience[]).map(x => <button type="button" key={x} onClick={() => setAudience(x)} className={`rounded-xl border px-3 py-3 text-xs font-black ${audience===x?'border-[#22C55E] bg-[#22C55E]/15 text-[#22C55E]':'border-[#23583E] bg-[#0B2318] text-[#A5C9B8]'}`}>{x === 'GENERAL' ? 'UMUM' : x}</button>)}</div></Field><SelectField label={labels.usage} value={answers.usage} onChange={v=>setAnswers({...answers,usage:v})} options={['Hampir setiap hari','Beberapa kali seminggu','Beberapa kali sebulan','Jarang / belum pernah']} /><SelectField label="Apa yang paling menentukan pilihan Anda?" value={answers.priority} onChange={v=>setAnswers({...answers,priority:v})} options={['Harga','Kualitas layanan','Kecepatan mendapat driver','Keamanan & kepercayaan','Transparansi biaya','Dukungan terhadap platform lokal']} /><TextField label={labels.fair} value={answers.fairPrice} onChange={v=>setAnswers({...answers,fairPrice:v})} placeholder="Tuliskan nominal, kisaran, atau prinsip yang menurut Anda wajar" /><SelectField label="Berapa waktu tunggu yang masih bisa Anda terima?" value={answers.waitTime} onChange={v=>setAnswers({...answers,waitTime:v})} options={['≤ 5 menit','6–10 menit','11–15 menit','> 15 menit jika tarif/layanan sepadan']} /><TextField label={labels.concern} value={answers.platformConcern} onChange={v=>setAnswers({...answers,platformConcern:v})} placeholder="Contoh: tarif, potongan, keamanan, order fiktif, biaya merchant, dll." /><TextArea label="Kalau Anda boleh mengubah SATU hal dari aplikasi transportasi/delivery yang ada sekarang, apa yang ingin Anda ubah?" value={answers.improvement} onChange={v=>setAnswers({...answers,improvement:v})} />{error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}<button disabled={busy} className="w-full rounded-2xl bg-[#22C55E] px-6 py-4 font-black text-[#05110A] disabled:opacity-50">{busy ? 'Mengirim...' : 'Kirim Pendapat Saya'}</button></form></main>;
}

function BetaRegistration({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ audience: 'CUSTOMER' as BetaAudience, fullName: '', whatsapp: '', city: 'Batu', note: '', consent: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setError(''); if (!form.consent) return setError('Persetujuan penggunaan data untuk keperluan Public Beta diperlukan.'); setBusy(true); try { const r=await fetch(`${API_BASE}/beta`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,source:new URLSearchParams(window.location.search).get('src')||'landing'})}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Pendaftaran belum dapat dikirim.'); onDone(); } catch(err:any){setError(err.message||'Terjadi kesalahan.')} finally{setBusy(false);} }
  return <main className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-16"><PublicTitle kicker="Public Beta" title="Jadilah bagian dari gelombang penguji pertama." text="Kami memulai terbatas agar setiap masukan benar-benar bisa dibaca, diuji, dan ditindaklanjuti."/><form onSubmit={submit} className="mt-8 space-y-5"><Field label="Saya ingin menguji sebagai"><div className="grid grid-cols-3 gap-2">{(['CUSTOMER','DRIVER','MERCHANT'] as BetaAudience[]).map(x=><button type="button" key={x} onClick={()=>setForm({...form,audience:x})} className={`rounded-xl border px-3 py-3 text-xs font-black ${form.audience===x?'border-[#22C55E] bg-[#22C55E]/15 text-[#22C55E]':'border-[#23583E] bg-[#0B2318] text-[#A5C9B8]'}`}>{x}</button>)}</div></Field><TextField label="Nama" value={form.fullName} onChange={v=>setForm({...form,fullName:v})} placeholder="Nama lengkap"/><TextField label="WhatsApp" value={form.whatsapp} onChange={v=>setForm({...form,whatsapp:v})} placeholder="08xxxxxxxxxx"/><TextField label="Kota / area aktivitas" value={form.city} onChange={v=>setForm({...form,city:v})} placeholder="Batu / Malang / Kabupaten Malang"/><TextArea label="Catatan (opsional)" value={form.note} onChange={v=>setForm({...form,note:v})} placeholder="Contoh: area yang paling sering Anda gunakan, jenis kendaraan, jenis usaha, dll."/><label className="flex cursor-pointer gap-3 rounded-2xl border border-[#23583E] bg-[#0B2318] p-4 text-sm text-[#A5C9B8]"><input type="checkbox" checked={form.consent} onChange={e=>setForm({...form,consent:e.target.checked})} className="mt-1 h-4 w-4 accent-[#22C55E]"/><span>Saya setuju data ini digunakan untuk komunikasi dan evaluasi Public Beta DHUKNOO. Data tidak dimaksudkan untuk dijual kepada pihak lain.</span></label>{error&&<p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}<button disabled={busy} className="w-full rounded-2xl bg-[#22C55E] px-6 py-4 font-black text-[#05110A] disabled:opacity-50">{busy?'Mendaftarkan...':'Daftar Public Beta'}</button></form></main>;
}

function Thanks({ title, go }: { title: string; go: (v: View) => void }) { return <main className="mx-auto flex min-h-[65vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center"><CheckCircle2 className="h-16 w-16 text-[#22C55E]"/><h1 className="mt-6 text-3xl font-black text-white md:text-5xl">{title}</h1><p className="mt-4 leading-7 text-[#A5C9B8]">DHUKNOO tumbuh dari implementasi, pengujian, kritik, dan perbaikan — bukan dari janji bahwa semuanya sudah sempurna.</p><button onClick={()=>go('landing')} className="mt-8 flex items-center gap-2 rounded-2xl border border-[#2C694C] px-5 py-3 font-black text-white">Kembali ke DHUKNOO <ChevronRight className="h-4 w-4"/></button></main>; }

function PublicFooter(){return <footer className="border-t border-[#23583E]/50 bg-[#041109] px-4 py-8 text-center text-xs text-[#729B87]"><p className="font-bold text-[#A5C9B8]">DHUKNOO · Batu — Malang Raya</p><p className="mt-1">Dekat. Terjangkau. Lebih Adil.</p></footer>}
function PublicTitle({kicker,title,text}:{kicker:string;title:string;text:string}){return <div><span className="text-xs font-black uppercase tracking-[.18em] text-[#22C55E]">{kicker}</span><h1 className="mt-2 text-3xl font-black text-white md:text-5xl">{title}</h1><p className="mt-4 leading-7 text-[#A5C9B8]">{text}</p></div>}
function ValueCard({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="rounded-3xl border border-[#23583E]/70 bg-[#0B2318]/80 p-5"><span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#22C55E]/10 text-[#22C55E]">{icon}</span><h3 className="font-black text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-[#A5C9B8]">{text}</p></div>}
function AudienceCard({icon,title,points}:{icon:React.ReactNode;title:string;points:string[]}){return <div className="rounded-3xl border border-[#23583E]/60 bg-[#0B2318] p-6"><span className="text-[#22C55E]">{icon}</span><h3 className="mt-4 text-xl font-black text-white">{title}</h3><div className="mt-4 space-y-3">{points.map(p=><p key={p} className="flex gap-2 text-sm text-[#A5C9B8]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#22C55E]"/>{p}</p>)}</div></div>}
function FlowBox({label,value,strong,accent}:{label:string;value:string;strong?:boolean;accent?:boolean}){return <div className={`rounded-2xl border p-4 text-center ${accent?'border-[#F59E0B]/40 bg-[#F59E0B]/10':strong?'border-[#22C55E]/50 bg-[#22C55E]/10':'border-[#23583E] bg-[#0B2318]'}`}><small className="block font-black tracking-wider text-[#729B87]">{label}</small><b className={`mt-1 block ${accent?'text-[#F59E0B]':'text-white'}`}>{value}</b></div>}
function FlowArrow(){return <div className="py-2 text-center text-xl text-[#22C55E]">↓</div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block"><span className="mb-2 block text-sm font-bold text-white">{label}</span>{children}</label>}
function TextField({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string}){return <Field label={label}><input required value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-[#23583E] bg-[#0B2318] px-4 py-3.5 text-white outline-none placeholder:text-[#557665] focus:border-[#22C55E]"/></Field>}
function TextArea({label,value,onChange,placeholder='Tuliskan jawaban Anda'}:{label:string;value:string;onChange:(v:string)=>void;placeholder?:string}){return <Field label={label}><textarea required value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={4} className="w-full resize-y rounded-2xl border border-[#23583E] bg-[#0B2318] px-4 py-3.5 text-white outline-none placeholder:text-[#557665] focus:border-[#22C55E]"/></Field>}
function SelectField({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:string[]}){return <Field label={label}><select required value={value} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border border-[#23583E] bg-[#0B2318] px-4 py-3.5 text-white outline-none focus:border-[#22C55E]"><option value="">Pilih jawaban</option>{options.map(o=><option key={o}>{o}</option>)}</select></Field>}
