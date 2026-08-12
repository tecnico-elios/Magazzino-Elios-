import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import ChecklistPage from "@/pages/ChecklistPage";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ChecklistPage />} />
          <Route path="*" element={<ChecklistPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{
          duration: 4000,
        }}
      />
    </div>
  );
}

export default App;
