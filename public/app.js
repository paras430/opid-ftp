document.addEventListener('DOMContentLoaded', () => {
    // Theme Toggling
    const themeToggle = document.getElementById('theme-toggle');
    const moonIcon = document.getElementById('moon-icon');
    const sunIcon = document.getElementById('sun-icon');
    
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

    // Folders Definition
    const FOLDERS = [
        { name: 'Contract/PAT docs', color: 'var(--c-purple)' },
        { name: 'Network', color: 'var(--c-blue)' },
        { name: 'Equipment', color: 'var(--c-green)' },
        { name: 'Letter/MOM/Report', color: 'var(--c-orange)' },
        { name: 'Images', color: 'var(--c-pink)' },
        { name: 'Misc', color: 'var(--c-gray)' }
    ];

    // State
    let allFiles = [];
    let currentActiveFolder = null; // null means 'All Files'
    let visibleCount = 5;
    
    // UI Elements
    const filesBody = document.getElementById('files-body');
    const searchInput = document.getElementById('search-input');
    const dashboardGrid = document.getElementById('dashboard-grid');
    const tableTitle = document.getElementById('table-title');
    const colFolder = document.getElementById('col-folder');
    const folderDropdownTemplate = document.getElementById('folder-dropdown-template');
    const btnBack = document.getElementById('btn-back');
    const btnLoadMore = document.getElementById('btn-load-more');

    btnBack.addEventListener('click', () => {
        currentActiveFolder = null;
        searchInput.value = '';
        visibleCount = 5;
        renderDashboard();
        applyCurrentFilter();
    });

    btnLoadMore.addEventListener('click', () => {
        visibleCount += 5;
        applyCurrentFilter();
    });

    // Bulk Actions Elements
    const selectAll = document.getElementById('select-all');
    const btnBulkEdit = document.getElementById('btn-bulk-edit');
    const btnBulkSave = document.getElementById('btn-bulk-save');
    const btnBulkDelete = document.getElementById('btn-bulk-delete');

    selectAll.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateBulkButtons();
    });

    function updateBulkButtons() {
        const checkboxes = document.querySelectorAll('.row-checkbox:checked');
        const count = checkboxes.length;
        btnBulkEdit.disabled = count === 0;
        btnBulkDelete.disabled = count === 0;
    }

    btnBulkEdit.addEventListener('click', () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        checked.forEach(cb => {
            const tr = cb.closest('tr');
            toggleEditMode(tr, true);
        });
        btnBulkEdit.classList.add('hidden');
        btnBulkSave.classList.remove('hidden');
    });

    btnBulkSave.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        let allOk = true;
        
        for (const cb of checked) {
            const tr = cb.closest('tr');
            const filename = cb.value;
            const newYear = tr.querySelector('.edit-year').value;
            const newRemarks = tr.querySelector('.edit-remarks').value;
            const newFolder = tr.querySelector('.edit-folder').value;

            try {
                const response = await fetch(`/api/files/${filename}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year: newYear, remarks: newRemarks, folder: newFolder })
                });
                if (!response.ok) allOk = false;
            } catch (error) {
                allOk = false;
            }
        }
        
        btnBulkEdit.classList.remove('hidden');
        btnBulkSave.classList.add('hidden');
        selectAll.checked = false;
        
        if (!allOk) alert('Some files failed to save.');
        loadFiles();
    });

    btnBulkDelete.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        if (!confirm(`Are you sure you want to delete ${checked.length} files?`)) return;

        for (const cb of checked) {
            await fetch(`/api/files/${cb.value}`, { method: 'DELETE' });
        }
        selectAll.checked = false;
        loadFiles();
    });

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
                loadFiles(); // Refresh table and dashboard
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

    // Load Files Data
    async function loadFiles() {
        try {
            const response = await fetch('/api/files');
            allFiles = await response.json();
            allFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
            
            renderDashboard();
            applyCurrentFilter();
        } catch (error) {
            console.error('Error loading files:', error);
            filesBody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load files.</td></tr>';
        }
    }

    // Render Dashboard Cards
    function renderDashboard() {
        dashboardGrid.innerHTML = '';
        
        FOLDERS.forEach(folder => {
            const count = allFiles.filter(f => f.folder === folder.name).length;
            
            const card = document.createElement('div');
            card.className = `folder-card ${currentActiveFolder === folder.name ? 'active' : ''}`;
            
            card.innerHTML = `
                <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="${folder.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <div class="folder-title">${escapeHtml(folder.name)}</div>
                <div class="folder-count">${count} file${count !== 1 ? 's' : ''}</div>
            `;
            
            card.addEventListener('click', () => {
                visibleCount = 5;
                if (currentActiveFolder === folder.name) {
                    currentActiveFolder = null;
                } else {
                    currentActiveFolder = folder.name;
                    searchInput.value = '';
                }
                renderDashboard();
                applyCurrentFilter();
            });
            
            dashboardGrid.appendChild(card);
        });
    }

    // Apply Filter based on Folder selection or Global Search
    function applyCurrentFilter() {
        const query = searchInput.value.toLowerCase().trim();
        
        let filteredFiles = allFiles;
        
        if (query) {
            currentActiveFolder = null; 
            renderDashboard(); 
            
            tableTitle.textContent = `Search Results for "${query}"`;
            colFolder.classList.remove('hidden'); 
            dashboardGrid.classList.add('hidden');
            btnBack.classList.remove('hidden');
            
            filteredFiles = allFiles.filter(file => 
                file.originalname.toLowerCase().includes(query) ||
                file.year.toString().includes(query) ||
                file.remarks.toLowerCase().includes(query) ||
                file.format.toLowerCase().includes(query) ||
                file.folder.toLowerCase().includes(query)
            );
        } else if (currentActiveFolder) {
            tableTitle.textContent = `${currentActiveFolder}`;
            colFolder.classList.add('hidden'); 
            dashboardGrid.classList.add('hidden');
            btnBack.classList.remove('hidden');
            
            filteredFiles = allFiles.filter(f => f.folder === currentActiveFolder);
        } else {
            tableTitle.textContent = `All Files`;
            colFolder.classList.remove('hidden'); 
            dashboardGrid.classList.remove('hidden');
            btnBack.classList.add('hidden');
        }

        if (filteredFiles.length > visibleCount) {
            btnLoadMore.classList.remove('hidden');
            renderTable(filteredFiles.slice(0, visibleCount));
        } else {
            btnLoadMore.classList.add('hidden');
            renderTable(filteredFiles);
        }
    }

    searchInput.addEventListener('input', () => {
        visibleCount = 5;
        applyCurrentFilter();
    });

    function formatDateTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString();
    }

    function renderTable(files) {
        filesBody.innerHTML = '';
        
        // Reset top-level buttons
        selectAll.checked = false;
        updateBulkButtons();
        btnBulkEdit.classList.remove('hidden');
        btnBulkSave.classList.add('hidden');

        if (files.length === 0) {
            filesBody.innerHTML = `<tr><td colspan="${currentActiveFolder ? '7' : '8'}" class="empty-state">No files found.</td></tr>`;
            return;
        }

        files.forEach((file, index) => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-filename', file.filename);
            
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            
            const viewUrl = `/api/view/${encodeURIComponent(file.filename)}`;
            const downloadUrl = `/api/download/${encodeURIComponent(file.filename)}`;
            
            // Build the folder dropdown for edit mode
            const folderSelectClone = folderDropdownTemplate.content.cloneNode(true);
            const folderSelectElement = folderSelectClone.querySelector('select');
            folderSelectElement.value = file.folder; // Set current folder

            tr.innerHTML = `
                <td><input type="checkbox" class="row-checkbox" value="${escapeHtml(file.filename)}"></td>
                <td>${index + 1}</td>
                <td>
                    <div style="font-weight: 500; word-break: break-all;">${escapeHtml(file.originalname)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted)">${sizeMB} MB</div>
                    <span class="format-badge">${escapeHtml(file.format)}</span>
                </td>
                <td class="cell-folder ${currentActiveFolder ? 'hidden' : ''}">
                    <span class="view-mode">${escapeHtml(file.folder)}</span>
                    <div class="edit-folder-wrapper"></div>
                </td>
                <td style="font-size: 0.85rem">${formatDateTime(file.uploadDate)}</td>
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
                        <a href="${viewUrl}" target="_blank" class="action-btn btn-primary-outline" title="View">View</a>
                        <a href="${downloadUrl}" download="${escapeHtml(file.originalname)}" class="action-btn btn-success-outline" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        </a>
                    </div>
                </td>
            `;
            
            tr.querySelector('.edit-folder-wrapper').appendChild(folderSelectElement);
            
            // Listen for checkbox changes
            const cb = tr.querySelector('.row-checkbox');
            cb.addEventListener('change', updateBulkButtons);
            
            filesBody.appendChild(tr);
        });
    }

    function toggleEditMode(tr, isEditing) {
        const viewModes = tr.querySelectorAll('.view-mode');
        const editInputs = tr.querySelectorAll('.edit-input');

        if (isEditing) {
            viewModes.forEach(el => el.classList.add('hidden'));
            editInputs.forEach(el => el.classList.remove('hidden'));
            const firstInput = tr.querySelector('.edit-year');
            if (firstInput) firstInput.focus();
        } else {
            viewModes.forEach(el => el.classList.remove('hidden'));
            editInputs.forEach(el => el.classList.add('hidden'));
        }
    }

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

    loadFiles();
});
