import { createRoot } from "react-dom/client";
import WorkshopClient from "../app/workshop-client";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(<WorkshopClient pages />);
