/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// Cache for iMacros folder ID
// Note: When null (not yet loaded or failed to load), we default to reloading
// on all bookmark events to maintain safe behavior.
let iMacrosFolderIdCache = null;

// Helper function to check if a bookmark is descendant of iMacros folder
// Always returns a Promise for consistent API
function isInMacrosFolder(bookmarkId) {
    // If cache not ready yet, reload to be safe (return Promise, not boolean)
    if (!iMacrosFolderIdCache) return Promise.resolve(true);

    return new Promise((resolve) => {
        // Check if the ID matches the iMacros folder
        if (bookmarkId === iMacrosFolderIdCache) {
            resolve(true);
            return;
        }

        // Traverse up the tree to check if this bookmark is under iMacros folder
        function checkParent(id) {
            chrome.bookmarks.get(id, (results) => {
                if (chrome.runtime.lastError || !results || results.length === 0) {
                    resolve(false);
                    return;
                }

                const node = results[0];
                if (!node.parentId) {
                    resolve(false);
                    return;
                }

                if (node.parentId === iMacrosFolderIdCache) {
                    resolve(true);
                    return;
                }

                checkParent(node.parentId);
            });
        }

        checkParent(bookmarkId);
    });
}

window.addEventListener("load", function (event) {
    TreeView.build();

    // Cache the iMacros folder ID on load
    getiMacrosFolderId().then(id => {
        iMacrosFolderIdCache = id;
    }).catch(() => {
        iMacrosFolderIdCache = null;
    });

    chrome.bookmarks.onChanged.addListener( function (id, x) {
        isInMacrosFolder(id).then(inFolder => {
            if (inFolder) window.location.reload();
        }).catch(err => {
            console.error("Error checking bookmark folder on change:", err);
        });
    });
    chrome.bookmarks.onChildrenReordered.addListener( function (id, x) {
        isInMacrosFolder(id).then(inFolder => {
            if (inFolder) window.location.reload();
        }).catch(err => {
            console.error("Error checking bookmark folder on reorder:", err);
        });
    });
    chrome.bookmarks.onCreated.addListener( function (id, x) {
        isInMacrosFolder(id).then(inFolder => {
            if (inFolder) window.location.reload();
        }).catch(err => {
            console.error("Error checking bookmark folder on create:", err);
        });
    });
    chrome.bookmarks.onRemoved.addListener(function (id, removeInfo) {
        // The deleted node no longer exists, so check its parent folder instead
        if (removeInfo && removeInfo.parentId) {
            isInMacrosFolder(removeInfo.parentId).then(inFolder => {
                if (inFolder) window.location.reload();
            }).catch(err => {
                console.warn("Failed to check removed bookmark parent:", err);
                // Reload anyway to be safe
                window.location.reload();
            });
        } else {
            // No parentId available, reload to be safe
            window.location.reload();
        }
    });

    window.top.onSelectionChanged(TreeView.selectedItem != null);
    document.body.oncontextmenu = function(e) {
        e.preventDefault()
    }

}, true);


window.addEventListener("iMacrosRunMacro", function(evt) {
    document.getElementById("imacros-bookmark-div").setAttribute("name", evt.detail.name);
    document.getElementById("imacros-macro-container").value = evt.detail.source;
});

function getiMacrosFolderId() {
    return new Promise((resolve, reject) => {
        chrome.bookmarks.getTree(tree => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            // first find iMacros subtree or create if not found
            // Note: This code duplicates logic in bg.js::ensureBookmarkFolderCreated().
            // Future refactoring: Extract to a shared utility function to avoid duplication.
            const iMacrosFolder = tree[0].children[0].children.find(
                child => child.title == "iMacros"
            )
            if (typeof iMacrosFolder == "undefined") {
                const bookmarksPanelId = tree[0].children[0].id
                chrome.bookmarks.create(
                    {parentId: bookmarksPanelId, title: "iMacros"},
                    folder => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve(folder.id)
                    }
                )
            } else {
                resolve(iMacrosFolder.id)
            }
        })
    })
}

const TreeView = {
    // build tree from iMacros bookmarks folder
    build: function () {
        getiMacrosFolderId().then(id => TreeView.buildSubTree_jstree(id))
            .catch(err => {
                console.error("Failed to build TreeView:", err);
                var p = document.createElement("p");
                p.style.color = "red";
                p.textContent = "Error loading bookmarks tree: " +
                    (err && err.message ? err.message : String(err));
                document.body.innerHTML = "";
                document.body.appendChild(p);
            })
    },

    buildSubTree_jstree: function (id, parent) {
        if (!parent) {
            parent = document.getElementById("jstree");
        }

        chrome.bookmarks.getSubTree(id, function (treeNodes) {
            if (chrome.runtime.lastError) {
                console.error("Error getting bookmark subtree:", chrome.runtime.lastError.message);
                return;
            }
            
            const createNode = function(text, id, type, hasChildren) {
                return {
                    'text': text,
                    'id': id,
                    'type': type,
                    'children': hasChildren
                }
            }

            const mapTree = function(nodes) {
                return nodes.filter(node => {
                    // skip non-macro bookmarks
                    if (node.url && !/iMacrosRunMacro/.test(node.url)) {
                        return false
                    } else {
                        return true
                    }
                }).map(node => {
                    const rv = {a_attr: {}}
                    if (node.url) {
                        rv.type = "macro"
                        rv.a_attr.bookmarklet = node.url
                    } else {
                        rv.type = "folder"
                        if (node.children)
                            rv.children = mapTree(node.children)
                    }
                    rv.title = node.title
                    rv.text = node.title
                    rv.id = node.id
                    rv.parentId = node.parentId
                    rv.a_attr.bookmark_id = node.id
                    node.type = rv.type
                    rv.a_attr.type = node.type
                    return rv
                })
            }

            const data = mapTree(treeNodes);
            if (!data[0].state) {
                data[0].state = {opened: true}
            }

            const onNewFolder = function () {
                let new_name = prompt("Enter new folder name", "New folder");
                const item = TreeView.selectedItem;
                let root_id;
                if (item.type == "folder") {
                    root_id = item.id;
                } else {
                    root_id = item.parentId;
                }

                chrome.bookmarks.getChildren(root_id, function (arr) {
                    if (chrome.runtime.lastError) {
                        console.error("Error getting bookmark children:", chrome.runtime.lastError.message);
                        return;
                    }
                    // add ...(n) to the folder name if such name already present
                    const names = {};
                    let count = 0;
                    let stop = false;
                    for (let i = 0; i < arr.length; i++) {
                        names[arr[i].title] = true;
                    }
                    while (!stop && count < arr.length + 1) {
                        if (names[new_name]) {
                            count++;
                            if (/\(\d+\)$/.test(new_name))
                                new_name = new_name.replace(/\(\d+\)$/,
                                                            "(" + count + ")");
                            else
                                new_name += " (" + count + ")";
                        } else {
                            stop = true;
                        }
                    }
                    chrome.bookmarks.create(
                        {
                            parentId: root_id,
                            title: new_name
                        },
                        function (folder) {
                            if (chrome.runtime.lastError) {
                                console.error("Error creating folder:", chrome.runtime.lastError.message);
                                return;
                            }
                            TreeView.buildSubTree(folder.id);
                        }
                    );
                });
            }

            const onRename = function () {
                const item = TreeView.selectedItem;
                if (!item) {
                    alert("Error: no item selected");
                    return;
                }
                const bookmark_id = item.id;
                const old_name = item.text;
                const new_name = prompt("Enter new name", old_name);
                if (!new_name)
                    return;
                if (item.type == "folder") {
                    chrome.bookmarks.update(bookmark_id, { title: new_name }, function() {
                        if (chrome.runtime.lastError) {
                            console.error("Error renaming folder:", chrome.runtime.lastError.message);
                        }
                    });
                } else if (item.type == "macro") {
                    chrome.bookmarks.get(bookmark_id, function (x) {
                        if (chrome.runtime.lastError) {
                            console.error("Error getting bookmark:", chrome.runtime.lastError.message);
                            return;
                        }
                        let url = x[0].url;
                        // change macro name in URL
                        try {
                            const m = url.match(/, n = \"([^\"]+)\";/);
                            url = url.replace(
                                    /, n = \"[^\"]+\";/,
                                ", n = \"" + encodeURIComponent(new_name) + "\";"
                            );
                        } catch (e) {
                            console.error(e);
                        }
                        chrome.bookmarks.update(
                            bookmark_id, { title: new_name, url: url },
                            function() {
                                if (chrome.runtime.lastError) {
                                    console.error("Error updating bookmark:", chrome.runtime.lastError.message);
                                }
                            }
                        );
                    });
                }
            }

            const onRemove = function () {
                const item = TreeView.selectedItem;
                if (!item) {
                    alert("Error: no item selected");
                    return;
                }
                const bookmark_id = item.id;
                if (!bookmark_id) {
                    alert("Can not delete " + item.type + " " + item.text);
                    return;
                }

                if (item.type == "macro") {
                    const yes = confirm("Are you sure you want to remove macro " +
                                      item.text +
                                      " ?");
                    if (yes) {
                        chrome.bookmarks.remove(bookmark_id, function () {
                            if (chrome.runtime.lastError) {
                                console.error("Error removing bookmark:", chrome.runtime.lastError.message);
                                return;
                            }
                            TreeView.selectedItem = null;
                        });
                    }
                } else if (item.type == "folder") {
                    const yes = confirm("Are you sure you want to remove folder " +
                                      item.text +
                                      " and all its contents?");
                    if (yes)
                        chrome.bookmarks.removeTree(bookmark_id, function () {
                            if (chrome.runtime.lastError) {
                                console.error("Error removing bookmark tree:", chrome.runtime.lastError.message);
                                return;
                            }
                            TreeView.selectedItem = null;
                        });
                }
            }

            const customMenu = function(node) {
                TreeView.selectedItem = node.original;

                const items = {
                    'Edit': {
                        'label': 'Edit',
                        'action': function () { window.top.edit(); }
                    },
                    'Convert': {
                        'label': 'Convert',
                        'action': function () { window.top.convert(); }
                    },
                    'New Folder': {
                        'label': 'New Folder',
                        'action': onNewFolder
                    },
                    'Rename': {
                        'label': 'Rename',
                        'action': onRename
                    },
                    'Remove': {
                        'label': 'Remove',
                        'action': onRemove
                    },
                    'Refresh Tree': {
                        'label': 'Refresh Tree',
                        'action': function () { window.location.reload(); }
                    }
                }

                if (node.type === 'folder') {
                    delete items.Edit;
                    delete items.Convert;
                }

                return items;
            };

            jQuery('#jstree_container').jstree({
                core: {
                    "check_callback": function (operation, node, parent, position, more) {
                        if (more.dnd && operation === "move_node") {
                            if(parent.id === "#") {
                                return false; // prevent moving a child above or below the root
                            }
                        }

                        return true; // allow everything else
                    },

                    data: data
                },
                types: {
                    "folder": {

                    },
                    "macro": {
                         icon: 'X'//'/skin/imglog.png'
                    }
                },
                contextmenu: {
                    items: customMenu
                },
                plugins: ['state', 'dnd', 'types', 'contextmenu', 'wholerow']
            });


            const getChildren = function(bookmarkId) {
                return new Promise((resolve, reject) => {
                    chrome.bookmarks.getChildren(bookmarkId, (children) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve(children);
                    })
                })
            }

            const namePrecedes = function(name, what) {
                if (name[0] == "#" && what[0] == "#")
                    return name.substring(1) < what.substring(1)
                else
                    return name < what
            }

            const findInsertionIndex = function(srcNode, subTree) {
                const place = subTree.find(node => {
                    if (srcNode.url && node.url) {
                        return namePrecedes(srcNode.title, node.title)
                    } else if (!srcNode.url && node.url) {
                        return true
                    } else if (srcNode.url && !node.url) {
                        return false
                    } else {
                        return srcNode.title < node.title
                    }
                })
                return place ? place.index : subTree.length
            }

            jQuery(document).on('dnd_stop.vakata', function (e, data) {
                const sourceId = data.element.getAttribute("bookmark_id")
                const targetId = data.event.target.getAttribute("bookmark_id")
                chrome.bookmarks.get([sourceId, targetId], (bookmarks) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error getting bookmarks for drag-and-drop:", chrome.runtime.lastError.message);
                        return;
                    }
                    const [src, tgt] = bookmarks;
                    const parentId = tgt.url? tgt.parentId : tgt.id
                    getChildren(parentId).then(children => {
                        const index = findInsertionIndex(src, children)
                        console.log("insertion index", index)
                        chrome.bookmarks.move(
                            src.id,
                            { parentId, index},
                            function () {
                                if (chrome.runtime.lastError) {
                                    console.error("Error moving bookmark:", chrome.runtime.lastError.message);
                                    return;
                                }
                                window.location.reload();
                            }
                        )
                    }).catch(err => {
                        console.error("Error during drag-and-drop move:", err);
                    })
                })
            });

            jQuery('#jstree_container').on('select_node.jstree', function (e, data) {
                const element = e.target;
                TreeView.selectedItem = element;
                if (data.node.type == 'macro') {
                    TreeView.selectedItem.type = "macro";
                    const div = document.getElementById("imacros-bookmark-div");
                    if (div.hasAttribute("file_id"))
                        div.removeAttribute("file_id");
                    div.setAttribute("bookmark_id", data.node.id);
                    div.setAttribute("name", data.node.text);
                    const bookmarklet = data.node.a_attr.bookmarklet;
                    const m = /var e_m64 = "([^"]+)"/.exec(bookmarklet);
                    if (!m) {
                        console.error("Can not parse bookmarklet " + data.node.text);
                        return;
                    }
                    document.getElementById("imacros-macro-container").value = decodeURIComponent(atob(m[1]));
                    window.top.onSelectionChanged(true);

                    e.preventDefault();

                }
                //folder
                else {
                    TreeView.selectedItem.type = "folder";
                    window.top.onSelectionChanged(false);
                }
            });

            jQuery('#jstree_container').on('dblclick.jstree', function (e, data) {

                const target_node = jQuery('#jstree_container').jstree(true).get_node(e.target.getAttribute("bookmark_id"));

                if (target_node.type == 'macro') {
                    setTimeout(function () { window.top.play(); }, 200);
                }
            });
        });
    },

    refresh: function() {
        window.location.reload();
    }
};
