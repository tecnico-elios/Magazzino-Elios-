import { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const FeaturesContext = createContext({ commesse_enabled: false, reload: () => {} });

export function FeaturesProvider({ children }) {
  const [features, setFeatures] = useState({ commesse_enabled: false });
  const reload = () => {
    axios.get(`${API}/features`).then(({ data }) => setFeatures(data)).catch(() => {});
  };
  useEffect(() => { reload(); }, []);
  return <FeaturesContext.Provider value={{ ...features, reload }}>{children}</FeaturesContext.Provider>;
}

export function useFeatures() { return useContext(FeaturesContext); }
