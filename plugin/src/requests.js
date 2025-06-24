export async function sendTreeReaderRequest(html, url) {
    try {
        const response = await fetch("https://htmlworker.treer.ai/generate", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ html_source: html , url: url}),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error sending HTML:', error);
        throw error;
    }
}

export async function pushToForestService(treeData, rootId) {
    const url = `https://page.treer.ai/api/updateTree`;
    const payload = JSON.stringify({
        tree: treeData,
        tree_id: String(rootId)
    });
    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: payload
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Tree updated successfully:', data);
        return data;
    } catch (error) {
        console.error('Error updating tree:', error);
        throw error;
    }
}