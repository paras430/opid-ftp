document.addEventListener('DOMContentLoaded', () => {
    // Theme Toggling
    const themeToggle = document.getElementById('theme-toggle');
    const moonIcon = document.getElementById('moon-icon');
    const sunIcon = document.getElementById('sun-icon');
    
    // Check saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });

    function updateThemeIcon(theme) {
        if (theme === 'dark') {
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        } else {
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        }
    }

    // File Upload
    const uploadForm = document.getElementById('upload-form');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadLoader = document.getElementById('upload-loader');
    const uploadStatus = document.getElementById('upload-status');
    const fileInput = document.getElementById('file-input');

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const file = fileInput.files[0];
        if (file && file.size > 50 * 1024 * 1024) {
            showStatus('File size exceeds 50MB limit.', 'error');
            return;
        }

        const formData = new FormData(uploadForm);
        
        setLoading(true);
        showStatus('', ''); // clear

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showStatus('File uploaded successfully!', 'success');
                uploadForm.reset();
                loadFiles(); // Refresh table
            } else {
                showStatus(result.error || 'Upload failed.', 'error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            showStatus('An error occurred during upload.', 'error');
        } finally {
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        uploadBtn.disabled = isLoading;
        uploadLoader.style.display = isLoading ? 'block' : 'none';
    }

    function showStatus(message, type) {
        uploadStatus.textContent = message;
        uploadStatus.className = 'status-msg ' + type;
    }

    // Load and Display Files
    let allFiles = [];
    const filesBody = document.getElementById('files-body');
    const searchInput = document.getElementById('search-input');

    async function loadFiles() {
        try {
            const response = await fetch('/api/files');
            allFiles = await response.json();
            renderFiles(allFiles);
        } catch (error) {
            console.error('Error loading files:', error);
            filesBody.innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load files.</td></tr>';
        }
    }

    function renderFiles(files) {
        filesBody.innerHTML = '';
        
        if (files.length === 0) {
            filesBody.innerHTML = '<tr><td colspan="6" class="empty-state">No files found.</td></tr>';
            return;
        }

        // Sort files by date descending
        files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

        files.forEach(file => {
            const tr = document.createElement('tr');
            
            // Format size for display
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 500">${escapeHtml(file.originalname)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted)">${sizeMB} MB</div>
                </td>
                <td><span class="format-badge">${escapeHtml(file.format)}</span></td>
                <td>${escapeHtml(file.projectId)}</td>
                <td>${escapeHtml(file.year)}</td>
                <td>${escapeHtml(file.remarks)}</td>
                <td>
                    <a href="/api/download/${file.filename}" class="download-btn" download>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        Download
                    </a>
                </td>
            `;
            filesBody.appendChild(tr);
        });
    }

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filteredFiles = allFiles.filter(file => 
            file.originalname.toLowerCase().includes(query) ||
            file.projectId.toLowerCase().includes(query) ||
            file.year.toString().includes(query) ||
            file.remarks.toLowerCase().includes(query) ||
            file.format.toLowerCase().includes(query)
        );
        renderFiles(filteredFiles);
    });

    // Helper to prevent XSS
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
             .toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Initial load
    loadFiles();
});
