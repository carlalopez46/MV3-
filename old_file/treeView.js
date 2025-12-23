/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

window.addEventListener("load", function (event) {
    TreeView.build();

    chrome.bookmarks.onChanged.addListener( function (id, x) {
        // TODO: listen to only iMacros descendants change
        window.location.reload();
    });
    chrome.bookmarks.onChildrenReordered.addListener( function (id, x) {
        // TODO: listen to only iMacros descendants change
        window.location.reload();
    });
    chrome.bookmarks.onCreated.addListener( function (id, x) {
        // TODO: listen to only iMacros descendants change
        window.location.reload();
    });
    chrome.bookmarks.onRemoved.addListener( function (id, x) {
        // TODO: listen to only iMacros descendants change
        window.location.reload();
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
            // first find iMacros subtree or create if not found
            // (code duplicates one in addToBookmarks(),
            // TODO: do something with that)
            let iMacrosFolder = tree[0].children[0].children.find(
                child => child.title == "iMacros"
            )
            if (typeof iMacrosFolder == "undefined") {
                let bookmarksPanelId = tree[0].children[0].id
                chrome.bookmarks.create(
                    {parentId: bookmarksPanelId, title: "iMacros"},
                    folder => resolve(folder.id)
                )
            } else {
                resolve(iMacrosFolder.id)
            }
        })
    })
}

var TreeView = {
    // build tree from iMacros bookmarks folder
    build: function () {
        getiMacrosFolderId().then(id => TreeView.buildSubTree_jstree(id))
    },

    buildSubTree_jstree: function (id, parent) {
        if (!parent) {
            parent = document.getElementById("jstree");
        }

        chrome.bookmarks.getSubTree(id, function (treeNodes) {
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
                    let rv = {a_attr: {}}
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

            let data = mapTree(treeNodes);
            if (!data[0].state) {
                data[0].state = {opened: true}
            }

            let onNewFolder = function () {
                var new_name = prompt("Enter new folder name", "New folder");
                var item = TreeView.selectedItem;
                var root_id;
                if (item.type == "folder") {
                    root_id = item.id;
                } else {
                    root_id = item.parentId;
                }

                chrome.bookmarks.getChildren(root_id, function (arr) {
                    // add ...(n) to the folder name if such name already present
                    var names = {}, count = 0, stop = false;
                    for (var i = 0; i < arr.length; i++) {
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
                            TreeView.buildSubTree(folder.id);
                        }
                    );
                });
            }

            let onRename = function () {
                var item = TreeView.selectedItem;
                if (!item) {
                    alert("Error: no item selected");
                    return;
                }
                var bookmark_id = item.id;
                var old_name = item.text;
                var new_name = prompt("Enter new name", old_name);
                if (!new_name)
                    return;
                if (item.type == "folder") {
                    chrome.bookmarks.update(bookmark_id, { title: new_name });
                } else if (item.type == "macro") {
                    chrome.bookmarks.get(bookmark_id, function (x) {
                        var url = x[0].url;
                        // change macro name in URL
                        try {
                            var m = url.match(/, n = \"([^\"]+)\";/);
                            url = url.replace(
                                    /, n = \"[^\"]+\";/,
                                ", n = \"" + encodeURIComponent(new_name) + "\";"
                            );
                        } catch (e) {
                            console.error(e);
                        }
                        chrome.bookmarks.update(
                            bookmark_id, { title: new_name, url: url }
                        );
                    });
                }
            }

            let onRemove = function () {
                var item = TreeView.selectedItem;
                if (!item) {
                    alert("Error: no item selected");
                    return;
                }
                var bookmark_id = item.id;
                if (!bookmark_id) {
                    alert("Can not delete " + item.type + " " + item.text);
                    return;
                }

                if (item.type == "macro") {
                    var yes = confirm("Are you sure you want to remove macro " +
                                      item.text +
                                      " ?");
                    if (yes) {
                        chrome.bookmarks.remove(bookmark_id, function () {
                            TreeView.selectedItem = null;
                        });
                    }
                } else if (item.type == "folder") {
                    var yes = confirm("Are you sure you want to remove folder " +
                                      item.text +
                                      " and all its contents?");
                    if (yes)
                        chrome.bookmarks.removeTree(bookmark_id, function () {
                            TreeView.selectedItem = null;
                        });
                }
            }

            const customMenu = function(node) {
                TreeView.selectedItem = node.original;

                var items = {
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
                    chrome.bookmarks.getChildren(bookmarkId, resolve)
                })
            }

            const namePrecedes = function(name, what) {
                if (name[0] == "#" && what[0] == "#")
                    return name.substring(1) < what.substring(1)
                else
                    return name < what
            }

            const findInsertionIndex = function(srcNode, subTree) {
                let place = subTree.find(node => {
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
                let sourceId = data.element.getAttribute("bookmark_id")
                let targetId = data.event.target.getAttribute("bookmark_id")
                chrome.bookmarks.get([sourceId, targetId], ([src, tgt]) => {
                    let parentId = tgt.url? tgt.parentId : tgt.id
                    getChildren(parentId).then(children => {
                        let index = findInsertionIndex(src, children)
                        console.log("insertion index", index)
                        chrome.bookmarks.move(
                            src.id,
                            { parentId, index},
                            function () { window.location.reload()}
                        )
                    })
                })
            });

            jQuery('#jstree_container').on('select_node.jstree', function (e, data) {
                var element = e.target;
                TreeView.selectedItem = element;
                if (data.node.type == 'macro') {
                    TreeView.selectedItem.type = "macro";
                    var div = document.getElementById("imacros-bookmark-div");
                    if (div.hasAttribute("file_id"))
                        div.removeAttribute("file_id");
                    div.setAttribute("bookmark_id", data.node.id);
                    div.setAttribute("name", data.node.text);
                    var bookmarklet = data.node.a_attr.bookmarklet;
                    var m = /var e_m64 = "([^"]+)"/.exec(bookmarklet);
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

                var target_node = jQuery('#jstree_container').jstree(true).get_node(e.target.getAttribute("bookmark_id"));

                if (target_node.type == 'macro') {
                    setTimeout(function () { window.top.play(); }, 200);
                }
            });
        });
    }
};
