import { createRoot } from "react-dom/client";
import { MainViewApp } from "./app/MainViewApp";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element.");

createRoot(rootElement).render(<MainViewApp />);
