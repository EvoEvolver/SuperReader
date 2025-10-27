import express, {Express} from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from "path";
import { SearchAgentExecutor } from "./searchAgentExecutor";
import { AgentRegistry } from "./agentRegistry";
import { DiscussionCoordinator } from "./discussionCoordinator";
import { IntelligentDiscussionCoordinator } from "./intelligentDiscussionCoordinator";
import {
    TaskStore,
    InMemoryTaskStore,
    DefaultRequestHandler,
} from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express';

// Import routers
import documentRoutes from './routes/documentRoutes';
import { createPaperAgentRoutes } from './routes/paperAgentRoutes';
import { createDiscussionRoutes } from './routes/discussionRoutes';
import searchRoutes from './routes/searchRoutes';
import { createAgentProxyRoutes } from './routes/agentProxyRoutes';

let FRONTEND_DIR = process.env.FRONTEND_DIR
if (!FRONTEND_DIR) {
    // Check if dist directory exists, otherwise fallback to frontend root
    const distPath = path.join(__dirname, "../../frontend/dist")
    const frontendPath = path.join(__dirname, "../../frontend")

    if (require('fs').existsSync(distPath)) {
        FRONTEND_DIR = distPath
    } else {
        FRONTEND_DIR = frontendPath
        console.warn('Frontend dist directory not found, using frontend root directory')
    }
}

dotenv.config();

const app: Express = express();
const port = 8081;

// Initialize Paper Agent Registry
const agentRegistry = new AgentRegistry();

// Initialize Discussion Coordinator
const discussionCoordinator = new DiscussionCoordinator();

// Initialize Intelligent Discussion Coordinator
const intelligentDiscussionCoordinator = new IntelligentDiscussionCoordinator();

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb'}));

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
    console.log(`[A2A] A2A protocol support initialized successfully`);
});


app.use(express.json());

// A2A Protocol: Agent Card definition
const superReaderAgentCard: any = {
    name: "SuperReader Knowledge Search Agent",
    description: "Advanced knowledge search agent that can search through document trees and provide intelligent answers with references using beam search and GPT-4o-mini",
    version: "1.0.0",
    url: `http://localhost:${port}/`, // Will be dynamically updated
    protocolVersion: "0.3.0",
    capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text", "task-status"],
    skills: [
        {
            id: "search_knowledge_tree",
            name: "Search Knowledge Tree",
            description: "Search through a document knowledge tree to find relevant information and generate comprehensive answers with clickable references. Requires a tree URL with ID parameter in the message.",
            tags: ["search", "knowledge tree", "AI search", "document analysis"],
            examples: [
                "What is the main methodology? tree: http://localhost:29999/?id=abc123",
                "Summarize the key findings located at http://localhost:29999/?id=xyz789",
                "Find relevant sections about machine learning url: http://treer.ai/?id=def456",
                "Give me an overview of http://localhost:29999/?id=ghi789",
                "Summary of the tree with id 3b37b95c-97c7-49cd-89e9-5e103f28f31b",
                "Analyze content from tree id abc123-def4-5678-90ab-cdef12345678"
            ],
            inputModes: ["text"],
            outputModes: ["text", "task-status"]
        }
    ],
    supportsAuthenticatedExtendedCard: false,
};

// Initialize A2A routes BEFORE static file routes to avoid conflicts
async function setupA2ARoutes() {
    // Update the agent card with the actual URL
    superReaderAgentCard.url = `http://localhost:${port}/`;

    // Create TaskStore
    const taskStore: TaskStore = new InMemoryTaskStore();

    // Create AgentExecutor
    const agentExecutor = new SearchAgentExecutor();

    // Create DefaultRequestHandler
    const requestHandler = new DefaultRequestHandler(
        superReaderAgentCard,
        taskStore,
        agentExecutor
    );

    // Create and setup A2AExpressApp
    const a2aAppBuilder = new A2AExpressApp(requestHandler);

    // Setup A2A routes on the existing express app (using default agent-card.json path)
    a2aAppBuilder.setupRoutes(app);

    // Also setup agent.json endpoint for compatibility
    app.get('/.well-known/agent.json', async (_req, res) => {
        try {
            const agentCard = await requestHandler.getAgentCard();
            res.json(agentCard);
        } catch (error) {
            console.error("Error fetching agent card:", error);
            res.status(500).json({ error: "Failed to retrieve agent card" });
        }
    });

    console.log(`[A2A] SuperReader agent initialized with URL: ${superReaderAgentCard.url}`);
    console.log(`[A2A] Agent Card available at:`);
    console.log(`  - http://localhost:${port}/.well-known/agent-card.json`);
    console.log(`  - http://localhost:${port}/.well-known/agent.json`);
}

// Setup A2A routes before static routes
setupA2ARoutes();

app.use(express.static(FRONTEND_DIR));
app.get('/wait', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/upload', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/searcher', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/discuss', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/agent-generator', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/agent-management', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.use(cors({
    origin: ['http://localhost:5173', "http://localhost:7777", "http://localhost:39999", "https://treer.ai"], // Allow your frontend origin
    methods: ['GET', 'POST', 'DELETE'], // Allowed methods
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true // Enable credentials (cookies, authorization headers, etc)
}));

// Mount routers
app.use('/', documentRoutes);
app.use('/', searchRoutes);
app.use('/paper-agents', createPaperAgentRoutes(agentRegistry));
app.use('/discussions', createDiscussionRoutes(discussionCoordinator, intelligentDiscussionCoordinator));
app.use('/agents', createAgentProxyRoutes(agentRegistry));

// =====================================
// Graceful Shutdown Handler
// =====================================

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await agentRegistry.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    await agentRegistry.shutdown();
    process.exit(0);
});
