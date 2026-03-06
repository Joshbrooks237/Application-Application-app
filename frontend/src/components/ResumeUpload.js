import React, { useState, useRef } from 'react';
import { uploadResume } from '../api';

export default function ResumeUpload({ resumeInfo, onUploadSuccess }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(ext)) {
      setError('Only PDF and DOCX files are supported');
      return;
    }

    setError('');
    setUploading(true);

    try {
      const result = await uploadResume(file);
      onUploadSuccess({
        fileName: result.fileName,
        textLength: result.textLength,
        preview: result.preview,
        uploadedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  return (
    <div className="animate-fadeInUp">
      <h2 className="text-lg font-bold text-slate-200 mb-4">Master Resume</h2>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
          ${dragging
            ? 'border-primary-light bg-primary-light/10 scale-[1.02]'
            : 'border-surface-overlay hover:border-slate-500 bg-surface-raised'
          }
        `}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-light border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Parsing resume...</p>
          </div>
        ) : (
          <>
            <p className="text-4xl mb-3">📄</p>
            <p className="text-sm font-semibold text-slate-300">
              Drop your resume here or click to browse
            </p>
            <p className="text-xs text-slate-500 mt-1">PDF or DOCX, max 10MB</p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger font-medium">{error}</p>
      )}

      {resumeInfo && (
        <div className="mt-4 bg-surface-raised border border-surface-overlay rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-success text-sm">✓</span>
            <span className="text-sm font-semibold text-slate-200">{resumeInfo.fileName}</span>
          </div>
          <p className="text-xs text-slate-500">
            {resumeInfo.textLength?.toLocaleString()} characters extracted
          </p>
          {resumeInfo.preview && (
            <p className="mt-2 text-xs text-slate-400 leading-relaxed line-clamp-4 overflow-hidden">
              {resumeInfo.preview}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
