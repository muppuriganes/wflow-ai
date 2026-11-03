import {
  Database,
  FileCode,
  FileText,
  HardDrive,
  Layers,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/utils/cn";

interface DocItem {
  id: string;
  filename: string;
  kbName: string;
  chunks: number;
  tokens: number;
  status: "indexed" | "processing" | "failed";
  updatedAt: string;
  size: string;
}

const SAMPLE_DOCS: DocItem[] = [
  {
    id: "doc-1",
    filename: "wflow_product_faq_2026.pdf",
    kbName: "Support Docs v2",
    chunks: 142,
    tokens: 48900,
    status: "indexed",
    updatedAt: "Today at 09:15 AM",
    size: "2.4 MB",
  },
  {
    id: "doc-2",
    filename: "saas_sales_playbook_enterprise.pdf",
    kbName: "Sales Playbook 2026",
    chunks: 88,
    tokens: 28400,
    status: "indexed",
    updatedAt: "Yesterday at 04:30 PM",
    size: "1.8 MB",
  },
  {
    id: "doc-3",
    filename: "service_level_agreements_v3.docx",
    kbName: "Pricing & SLAs",
    chunks: 34,
    tokens: 11200,
    status: "indexed",
    updatedAt: "Oct 28, 2026",
    size: "450 KB",
  },
];

export function KnowledgeBasePage() {
  const [docs, setDocs] = useState<DocItem[]>(SAMPLE_DOCS);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocItem | null>(SAMPLE_DOCS[0] || null);

  // Retrieval Test Query State
  const [testQuery, setTestQuery] = useState("What is the refund policy?");
  const [retrievalResults, setRetrievalResults] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleTestSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;

    setIsSearching(true);
    setTimeout(() => {
      setRetrievalResults([
        `Chunk #42 (Similarity 0.94): "Refunds are processed within 7 business days of cancellation via the original payment method with a GST credit note generated automatically."`,
        `Chunk #43 (Similarity 0.88): "Annual subscription plans cancelled within the 14-day evaluation window receive a full 100% refund."`,
      ]);
      setIsSearching(false);
    }, 500);
  };

  const filtered = docs.filter(
    (d) =>
      d.filename.toLowerCase().includes(search.toLowerCase()) ||
      d.kbName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
            Knowledge Base
          </h1>
          <p className="mt-1 text-sm text-muted">
            Upload business documentation, product manuals, and FAQs for instant semantic retrieval by AI agents.
          </p>
        </div>

        <Button onClick={() => setUploadOpen(true)} className="shadow-xs">
          <Upload className="size-4" />
          <span>Upload Document</span>
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Indexed Vectors" value="1,248" icon={Layers} />
        <MetricCard label="Processed Chunks" value="264" icon={FileCode} />
        <MetricCard label="Storage Consumed" value="4.65 MB" icon={HardDrive} />
        <MetricCard label="Embedding Model" value="text-embedding-3" icon={Sparkles} />
      </div>

      {/* Two Column Layout: Documents on Left, Document Details on Right */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Left Column: Document List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 size-4 text-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents by name or knowledge base..."
                className="pl-9 text-xs"
              />
            </div>
            <span className="text-xs text-muted">{docs.length} documents</span>
          </div>

          <Card className="border border-border shadow-card overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Document</TH>
                  <TH className="w-36">Knowledge Base</TH>
                  <TH className="w-24">Chunks</TH>
                  <TH className="w-28">Status</TH>
                  <TH className="w-24 text-right">Size</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  return (
                    <TR
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected ? "bg-primary-soft/60" : "hover:bg-surface-muted/40",
                      )}
                    >
                      <TD>
                        <div className="flex items-center gap-2.5">
                          <FileText className="size-4 text-primary shrink-0" />
                          <span className="font-semibold text-foreground text-[13px] truncate">
                            {doc.filename}
                          </span>
                        </div>
                      </TD>
                      <TD className="text-xs text-muted">{doc.kbName}</TD>
                      <TD className="font-mono text-xs text-foreground">{doc.chunks}</TD>
                      <TD>
                        <StatusPill tone="success" label="Indexed" />
                      </TD>
                      <TD className="text-right font-mono text-xs text-muted">{doc.size}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </div>

        {/* Right Column: Document Detail & Semantic Retrieval Tester */}
        <div className="space-y-6">
          {selectedDoc && (
            <Card className="border border-border shadow-card p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <span className="font-bold text-sm text-foreground truncate max-w-[240px]">
                    {selectedDoc.filename}
                  </span>
                </div>
                <StatusPill tone="success" label="Ready" />
              </div>

              {/* Processing Timeline */}
              <div className="space-y-2 text-xs">
                <p className="font-semibold text-muted text-[11px] uppercase tracking-wider">Processing Timeline</p>
                <div className="space-y-1.5 border-l-2 border-primary/30 pl-3">
                  <div>
                    <p className="font-semibold text-foreground">Upload Complete</p>
                    <p className="text-[11px] text-muted">{selectedDoc.updatedAt}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Chunking & Text Extraction</p>
                    <p className="text-[11px] text-muted">{selectedDoc.chunks} overlapping chunks generated</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Vector Embeddings Generated</p>
                    <p className="text-[11px] text-muted">1536-dimensional embeddings stored in pgvector</p>
                  </div>
                </div>
              </div>

              {/* Document Metadata Summary */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/60">
                <div>
                  <span className="text-muted block text-[11px]">Tokens Indexed</span>
                  <span className="font-mono font-semibold text-foreground">
                    {selectedDoc.tokens.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted block text-[11px]">KB Category</span>
                  <span className="font-semibold text-primary">{selectedDoc.kbName}</span>
                </div>
              </div>
            </Card>
          )}

          {/* Semantic Retrieval Testing Card */}
          <Card className="border border-border shadow-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-foreground font-bold text-sm">
              <Database className="size-4 text-primary" />
              <span>Vector Retrieval Test</span>
            </div>
            <p className="text-xs text-muted">
              Test semantic search queries against your indexed documentation.
            </p>

            <form onSubmit={handleTestSearch} className="space-y-2">
              <Input
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="Ask a question..."
                className="text-xs"
              />
              <div className="flex justify-end">
                <Button size="sm" type="submit" disabled={isSearching || !testQuery.trim()}>
                  <Search className="size-3" />
                  <span>Search Chunks</span>
                </Button>
              </div>
            </form>

            {/* Results */}
            {retrievalResults.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/60">
                <span className="text-[11px] font-semibold text-muted">Top Matching Chunks</span>
                {retrievalResults.map((r, i) => (
                  <div key={i} className="rounded bg-surface-muted border border-border p-2.5 text-xs text-foreground font-mono">
                    {r}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Upload Dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="Upload Knowledge Document"
        description="Supported formats: PDF, DOCX, TXT, CSV, MD. Documents are automatically chunked and embedded."
      >
        <div className="space-y-4">
          <Field label="Target Knowledge Base">
            <NativeSelect>
              <option value="Support Docs v2">Support Docs v2</option>
              <option value="Sales Playbook 2026">Sales Playbook 2026</option>
              <option value="Pricing & SLAs">Pricing & SLAs</option>
            </NativeSelect>
          </Field>

          <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 text-center bg-surface-muted/30 hover:border-primary transition-colors cursor-pointer">
            <Upload className="size-8 text-muted mb-2" />
            <p className="text-sm font-semibold text-foreground">Click to browse or drag and drop files</p>
            <p className="text-xs text-muted mt-1">PDF, DOCX, TXT up to 25 MB</p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setDocs([
                  {
                    id: `doc-${Date.now()}`,
                    filename: "new_uploaded_document.pdf",
                    kbName: "Support Docs v2",
                    chunks: 48,
                    tokens: 16500,
                    status: "indexed",
                    updatedAt: "Just now",
                    size: "1.1 MB",
                  },
                  ...docs,
                ]);
                setUploadOpen(false);
              }}
            >
              Start Ingestion
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
