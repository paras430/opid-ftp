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
        setTimeout(() => { uploadStatus.textContent = ''; }, 5000);
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
            filesBody.innerHTML = '<tr><td colspan="7" class="empty-state">Failed to load files.</td></tr>';
        }
    }

    // Function to format date and time
    function formatDateTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString();
    }

    function renderFiles(files) {
        filesBody.innerHTML = '';
        
        if (files.length === 0) {
            filesBody.innerHTML = '<tr><td colspan="7" class="empty-state">No files found.</td></tr>';
            return;
        }

        // Sort files by date descending
        files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

        files.forEach(file => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-filename', file.filename);
            
            // Format size for display
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            const viewUrl = `/uploads/${file.safeFolder}/${file.filename}`;
            const downloadUrl = `/api/download/${file.filename}`;
            
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 500; word-break: break-all;">${escapeHtml(file.originalname)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted)">${sizeMB} MB</div>
                    <span class="format-badge">${escapeHtml(file.format)}</span>
                </td>
                <td>${escapeHtml(file.folder)}</td>
                <td style="font-size: 0.85rem">${formatDateTime(file.uploadDate)}</td>
                
                <!-- Editable Cells -->
                <td class="cell-project">
                    <span class="view-mode">${escapeHtml(file.projectId)}</span>
                    <input type="text" class="edit-input hidden edit-project" value="${escapeHtml(file.projectId)}">
                </td>
                <td class="cell-year">
                    <span class="view-mode">${escapeHtml(file.year)}</span>
                    <input type="number" class="edit-input hidden edit-year" value="${escapeHtml(file.year)}">
                </td>
                <td class="cell-remarks">
                    <span class="view-mode">${escapeHtml(file.remarks)}</span>
                    <input type="text" class="edit-input hidden edit-remarks" value="${escapeHtml(file.remarks)}">
                </td>
                
                <td>
                    <div class="actions-group">
                        <button class="action-btn btn-primary-outline btn-edit">Edit</button>
                        <button class="action-btn btn-success-outline btn-save hidden">Save</button>
                        <a href="${viewUrl}" target="_blank" class="action-btn btn-primary-outline">View</a>
                        <a href="${downloadUrl}" download="${escapeHtml(file.originalname)}" class="action-btn btn-primary-outline">Download</a>
                        <button class="action-btn btn-danger-outline btn-delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                        </button>
                    </div>
                </td>
            `;
            filesBody.appendChild(tr);

            // Add Event Listeners for this row
            const btnEdit = tr.querySelector('.btn-edit');
            const btnSave = tr.querySelector('.btn-save');
            const btnDelete = tr.querySelector('.btn-delete');

            btnEdit.addEventListener('click', () => toggleEditMode(tr, true));
            btnSave.addEventListener('click', () => saveRowEdits(tr, file.filename));
            btnDelete.addEventListener('click', () => deleteFile(file.filename));
        });
    }

    function toggleEditMode(tr, isEditing) {
        const viewModes = tr.querySelectorAll('.view-mode');
        const editInputs = tr.querySelectorAll('.edit-input');
        const btnEdit = tr.querySelector('.btn-edit');
        const btnSave = tr.querySelector('.btn-save');

        if (isEditing) {
            viewModes.forEach(el => el.classList.add('hidden'));
            editInputs.forEach(el => el.classList.remove('hidden'));
            btnEdit.classList.add('hidden');
            btnSave.classList.remove('hidden');
            tr.querySelector('.edit-project').focus();
        } else {
            viewModes.forEach(el => el.classList.remove('hidden'));
            editInputs.forEach(el => el.classList.add('hidden'));
            btnEdit.classList.remove('hidden');
            btnSave.classList.add('hidden');
        }
    }

    async function saveRowEdits(tr, filename) {
        const newProject = tr.querySelector('.edit-project').value;
        const newYear = tr.querySelector('.edit-year').value;
        const newRemarks = tr.querySelector('.edit-remarks').value;

        // Update UI optimistically
        tr.querySelector('.cell-project .view-mode').textContent = newProject;
        tr.querySelector('.cell-year .view-mode').textContent = newYear;
        tr.querySelector('.cell-remarks .view-mode').textContent = newRemarks;
        
        toggleEditMode(tr, false);

        try {
            const response = await fetch(`/api/files/${filename}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: newProject, year: newYear, remarks: newRemarks })
            });

            if (!response.ok) {
                throw new Error('Failed to save');
            }
            
            // Update local state quietly
            const fileIndex = allFiles.findIndex(f => f.filename === filename);
            if(fileIndex > -1) {
                allFiles[fileIndex].projectId = newProject;
                allFiles[fileIndex].year = newYear;
                allFiles[fileIndex].remarks = newRemarks;
            }

        } catch (error) {
            console.error('Error saving edits:', error);
            alert('Failed to save changes. Please try again.');
            loadFiles(); // reload to revert
        }
    }

    async function deleteFile(filename) {
        if (!confirm('Are you sure you want to delete this file? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/files/${filename}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadFiles(); // Refresh table
            } else {
                const res = await response.json();
                alert(res.error || 'Failed to delete file.');
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('An error occurred while deleting the file.');
        }
    }

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filteredFiles = allFiles.filter(file => 
            file.originalname.toLowerCase().includes(query) ||
            file.projectId.toLowerCase().includes(query) ||
            file.year.toString().includes(query) ||
            file.remarks.toLowerCase().includes(query) ||
            file.format.toLowerCase().includes(query) ||
            file.folder.toLowerCase().includes(query)
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
