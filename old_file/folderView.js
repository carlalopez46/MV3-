/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

window.addEventListener("load", function (event) {
    afio.isInstalled().then(function(installed) {
        if (!installed) {
            document.body.innerHTML = "<p style='color:red'>"+
                "Install file access support first"+
                "</p>";
        } else {
            TreeView.build(window.top.args ? window.top.args.path : null);
        }
    });
}, true);

var TreeView = {
    
    // predicate for sorting nodes
    sortPredicate: function(a, b) {
        // string compare function to sort nodes
        var node_compare = function (a, b) {
            var la = a.leafName.toLowerCase(),
                lb = b.leafName.toLowerCase();
            var bound = Math.min(la.length, lb.length);

            for (var i = 0; i < bound; i++) {
                var l = la.charAt(i), r = lb.charAt(i), x;
                if (l == r)
                    continue;
                if (x = l.localeCompare(r))
                    return x;
            }

            return la.length - lb.length; // longer string is greater
        };

        return node_compare(a, b);
    },

    // build tree from iMacros bookmarks folder
    build: function (root) {
        jQuery('#jstree').jstree({
            'core': {
                'data': function(node, cb) { getNodes(node, cb); }
            },
            'plugins': ['wholerow']
        });

        jQuery('#jstree').on("changed.jstree", function (e, data) {

            document.getElementById("path").value = data.selected;
        });
        
        jQuery('#jstree').on("loaded.jstree", function (event, data) {
            selectFirstNode();
        })

        jQuery('#jstree').on('dblclick.jstree', function (e, data) {
                
            var target_node = jQuery('#jstree').jstree(true).get_node(e.target.id);
                
            if (target_node.text == '..') {
                root = target_node.id;
                jQuery('#jstree').jstree(true).refresh();
            }
        });

        jQuery('#jstree').on('refresh.jstree', function (e, data) {
            selectFirstNode();
        });

        function selectFirstNode() {
            jQuery('#jstree').jstree("select_node", "ul > li:first");
            jQuery('#jstree').jstree("open_node", "ul > li:first");
        }

        function getNodes(node, cb) {
	
            var data_obj;
	
            if(node.id === "#") {
		
                if (root == "My Computer") {

                    data_obj = createNode('My Computer', '', 'computer');

                    afio.getLogicalDrives().then(function(drives) {
                        data_obj.children = new Array();
				
                        for (var i = 0; i < drives.length; i++) {

                            var drive_caption = drives[i].path+
                                                (drives[i].path[drives[i].path.length-1] == __psep() ?
                                                 "": __psep());
					
                            data_obj.children[i] = createNode(drive_caption, drives[i].path, 'drive');
                        }

                        cb([data_obj]);
                    }).catch(console.error.bind(console));
                } else {
                    afio.getDefaultDir("savepath").then(function(savepath) {
                        var root_node = root ? afio.openNode(root) : savepath;

                        // make "Up" element first
                        var parent_path = /^[A-Z]:\\?$/.test(root) ?
                            '' : root_node.parent.path; //using empty string for 'My Computer' so that its not seen as a selection by browse.js

                        data_obj = createNode('..', parent_path, 'folder');
                        data_obj.children = getSubDirs(root_node, data_obj, cb);
                    }).catch(console.error.bind(console));
                }
            }
            else {
                getSubDirs(afio.openNode(node.id), data_obj, cb);
            }
        }

        function getSubDirs(root_node, data_obj, cb) {

            afio.getNodesInDir(root_node, ":is_dir")
            .then(function(nodes) {
                // We need to sort array
                nodes.sort(TreeView.sortPredicate);

                var subDirs = new Array();
		
                for (var x of nodes) {
                    subDirs.push(createNode(x.leafName, x.path, 'folder'));
            }
		
                if(data_obj && subDirs.length) {
                    data_obj.children = subDirs;
                    cb(data_obj);
                } else if(subDirs.length) {
                    cb(subDirs);
                } else if(data_obj) {
                    cb([data_obj]);
                } else {
                    cb([]);
                }
            }).catch(console.error.bind(console));
        }

        function createNode(text, id, type) {
            return {'text': text, 'id': id, 'type': type, 'children': true };
        }
    }
};
