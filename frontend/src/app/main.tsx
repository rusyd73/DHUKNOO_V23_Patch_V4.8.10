import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "../styles/index.css";

import "../services/socket";

// PERBAIKAN: sebelumnya di sini App dibungkus <Providers> (app/providers.tsx),
// yang membuat QueryClient-nya SENDIRI. Tapi App.tsx (lihat di sana) JUGA
// membuat QueryClient sendiri dan membungkus SELURUH isinya dengan
// QueryClientProvider miliknya sendiri lagi -- karena React Context yang
// lebih dalam menang, QueryClient dari Providers TIDAK PERNAH benar-benar
// terpakai oleh komponen mana pun, walau kelihatannya "terpasang". app/
// providers.tsx sudah dihapus untuk menghindari kebingungan (persis pola
// duplikat mati yang sama seperti isu shared-api/shared-utils/shared-types
// sebelumnya) -- App.tsx tetap satu-satunya sumber QueryClient yang nyata.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);