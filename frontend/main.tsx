import React from 'react';
import ReactDOM from 'react-dom/client';
import { Routes, Route } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { AppWait } from './AppWait';
import AppUpload from "./AppUpload";
import AppSearcher from "./AppSearcher";
import AppDiscussion from "./AppDiscussion";
import AppAgentGenerator from "./AppAgentGenerator";

const rootElement = document.getElementById('root');

if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
        <BrowserRouter>
            <Routes>
                <Route path="/wait" element={<AppWait />} />
                <Route path="/upload" element={<AppUpload />} />
                <Route path="/searcher" element={<AppSearcher />} />
                <Route path="/discuss" element={<AppDiscussion />} />
                <Route path="/agent-generator" element={<AppAgentGenerator />} />
            </Routes>
        </BrowserRouter>
    );
} else {
    console.error('Root element not found in the document');
}