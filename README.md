# Max - AI-Powered CRM Platform

Max is an intelligent, voice-enabled Customer Relationship Management (CRM) platform that combines traditional CRM functionality with advanced AI capabilities for natural, conversational user interactions.

## What is Max?

Max is a comprehensive business platform that enables organizations to:

- **Manage Customer Data**: Create and manage dynamic data models, forms, and workflows tailored to your business needs
- **Interact Naturally**: Communicate with your CRM using voice commands and natural language through "Max," an AI assistant
- **Generate Content**: Create images, search YouTube videos, and generate visual content on demand
- **Scale Multi-Tenant**: Support multiple organizations with complete data isolation and tenant-specific configurations

## Key Features

### 🤖 AI-Powered Assistant ("Max")
- **Voice Interaction**: Hands-free operation with speech-to-text and text-to-speech capabilities
- **Natural Language Processing**: Powered by Google Vertex AI (Gemini) for intelligent conversations
- **Automatic Command Execution**: AI can automatically create data models and documents based on user requests
- **Visual Content Generation**: Create images using AI-generated prompts
- **YouTube Integration**: Search and embed relevant videos based by user requests
- **Barge-in Support**: Interrupt the AI mid-response for more natural conversations

### 🏢 Dynamic CRM Core
- **Custom Data Models**: Define and manage business-specific data structures dynamically
- **Form Builder**: Create custom forms tied to your data models
- **Workflow Management**: Design and execute business processes
- **Event Sourcing**: Complete audit trail of all data changes
- **Query Engine**: Flexible data querying and reporting

### 🌐 Multi-Tenant Architecture
- **Complete Isolation**: Each tenant has separate data, configurations, and users
- **Scalable Design**: Support unlimited organizations on a single deployment
- **Role-Based Access**: Granular permissions and capability management
- **Tenant-Specific Customization**: Each organization can customize models, forms, and workflows

### 🎙️ Advanced Voice Features
- **High-Quality TTS**: ElevenLabs integration for natural-sounding voice synthesis
- **Voice Activity Detection**: Intelligent detection of when users are speaking
- **Real-time Transcription**: Live speech-to-text with partial results
- **Configurable Voice Settings**: Customize voice characteristics, speed, and style

## Who is Max For?

### Primary Users
- **Small to Medium Businesses**: Organizations needing a flexible, AI-enhanced CRM without complex setup
- **Customer Service Teams**: Teams wanting hands-free, voice-driven customer interaction tools
- **Sales Organizations**: Sales teams needing quick access to customer data and content generation
- **Service Providers**: Businesses requiring custom data models and workflow automation

### Use Cases
- **Voice-First CRM**: Manage customer relationships using natural voice commands
- **Dynamic Business Applications**: Create custom business apps without traditional development
- **AI-Enhanced Customer Support**: Provide intelligent, context-aware customer assistance
- **Content-Rich Presentations**: Generate images and videos for customer interactions
- **Multi-Location Businesses**: Manage multiple branches/franchises with separate data spaces

## Technical Architecture

### Backend (API)
- **Node.js/Express**: RESTful API with TypeScript
- **MongoDB**: Document-based storage with multi-tenant data isolation
- **Google Vertex AI**: Large language model integration for conversational AI
- **ElevenLabs**: Professional text-to-speech synthesis
- **Dynamic Schema**: Runtime model definition and validation

### Frontend (Runtime UI)
- **React/TypeScript**: Modern web application with Vite build system
- **Voice Processing**: Real-time speech recognition and audio processing
- **GSAP Animations**: Smooth, professional user interface animations
- **Responsive Design**: Works across desktop and mobile devices

### Data Architecture
- **Event Sourcing**: Complete audit trail of all system changes
- **Multi-Tenant**: Isolated data spaces for each organization
- **Dynamic Models**: Runtime-defined data structures and validation
- **Bootstrap API**: Configuration-driven UI generation

## Getting Started

### Development Setup
```bash
# Install dependencies
pnpm install

# Start API server
pnpm dev:api

# Start UI application (in another terminal)
pnpm dev:ui
```

### Environment Configuration
The system requires:
- MongoDB connection
- Google Cloud Vertex AI credentials
- ElevenLabs API key (for voice synthesis)
- Optional: YouTube API key for video search

### Production Deployment
Max is designed for cloud deployment with proper authentication, tenant provisioning, and scalable infrastructure.

## System Status

**Current Version**: 1.0.0  
**Development Status**: Active development with core features implemented  
**Authentication**: Currently in development mode (production auth planned)  
**Multi-tenancy**: Fully implemented with tenant isolation
